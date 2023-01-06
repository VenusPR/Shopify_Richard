import { getConnection, DeepPartial, EntityManager } from "typeorm"
import { isDefined, MedusaError } from "medusa-core-utils"
import {
  FindConfig,
  buildQuery,
  IEventBusService,
  FilterableReservationItemProps,
  CreateReservationItemInput,
  TransactionBaseService,
} from "@medusajs/medusa"

import { ReservationItem } from "../models"
import { CONNECTION_NAME } from "../config"
import { InventoryLevelService } from "."

type InjectedDependencies = {
  eventBusService: IEventBusService
  inventoryLevelService: InventoryLevelService
}

export default class ReservationItemService extends TransactionBaseService {
  static Events = {
    CREATED: "reservation-item.created",
    UPDATED: "reservation-item.updated",
    DELETED: "reservation-item.deleted",
    DELETED_BY_LINE_ITEM: "reservation-item.deleted-by-line-item",
  }

  protected manager_: EntityManager
  protected transactionManager_: EntityManager | undefined
  protected readonly eventBusService_: IEventBusService
  protected readonly inventoryLevelService_: InventoryLevelService

  constructor({
    eventBusService,
    inventoryLevelService,
  }: InjectedDependencies) {
    super(arguments[0])

    this.manager_ = this.getManager()
    this.eventBusService_ = eventBusService
    this.inventoryLevelService_ = inventoryLevelService
  }

  private getManager(): EntityManager {
    if (this.manager_) {
      return this.transactionManager_ ?? this.manager_
    }

    const connection = getConnection(CONNECTION_NAME)
    return connection.manager
  }

  /**
   * Lists reservation items that match the provided filter.
   * @param {FilterableReservationItemProps} [selector={}] - Filters to apply to the reservation items.
   * @param {FindConfig} [config={ relations: [], skip: 0, take: 10 }] - Configuration for the query.
   * @returns {Promise<ReservationItem[]>} - Array of reservation items that match the selector.
   */
  async list(
    selector: FilterableReservationItemProps = {},
    config: FindConfig<ReservationItem> = { relations: [], skip: 0, take: 10 }
  ): Promise<ReservationItem[]> {
    const manager = this.getManager()
    const itemRepository = manager.getRepository(ReservationItem)

    const query = buildQuery(selector, config)
    return await itemRepository.find(query)
  }

  /**
   * Lists reservation items that match the provided filter and returns the total count.
   * @param {FilterableReservationItemProps} [selector={}] - Filters to apply to the reservation items.
   * @param {FindConfig} [config={ relations: [], skip: 0, take: 10 }] - Configuration for the query.
   * @returns {Promise<[ReservationItem[], number]>} - Array of reservation items that match the selector and the total count.
   */
  async listAndCount(
    selector: FilterableReservationItemProps = {},
    config: FindConfig<ReservationItem> = { relations: [], skip: 0, take: 10 }
  ): Promise<[ReservationItem[], number]> {
    const manager = this.getManager()
    const itemRepository = manager.getRepository(ReservationItem)

    const query = buildQuery(selector, config)
    return await itemRepository.findAndCount(query)
  }

  /**
   * Retrieves a reservation item by its id.
   * @param {string} reservationItemId - The id of the reservation item to retrieve.
   * @param {FindConfig} [config={}] - Configuration for the query.
   * @returns {Promise<ReservationItem>} - The reservation item with the provided id.
   * @throws {MedusaError} If reservationItemId is not defined or if the reservation item was not found.
   */
  async retrieve(
    reservationItemId: string,
    config: FindConfig<ReservationItem> = {}
  ): Promise<ReservationItem> {
    if (!isDefined(reservationItemId)) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `"reservationItemId" must be defined`
      )
    }

    const manager = this.getManager()
    const reservationItemRepository = manager.getRepository(ReservationItem)

    const query = buildQuery({ id: reservationItemId }, config)
    const [reservationItem] = await reservationItemRepository.find(query)

    if (!reservationItem) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ReservationItem with id ${reservationItemId} was not found`
      )
    }

    return reservationItem
  }

  /**
   * Create a new reservation item.
   * @param {CreateReservationItemInput} data - The reservation item data.
   * @returns {Promise<ReservationItem>} - The created reservation item.
   */
  async create(data: CreateReservationItemInput): Promise<ReservationItem> {
    const result = await this.atomicPhase_(async (manager) => {
      const itemRepository = manager.getRepository(ReservationItem)

      const inventoryItem = itemRepository.create({
        inventory_item_id: data.inventory_item_id,
        line_item_id: data.line_item_id,
        location_id: data.location_id,
        quantity: data.quantity,
        metadata: data.metadata,
      })

      const [newInventoryItem] = await Promise.all([
        itemRepository.save(inventoryItem),
        this.inventoryLevelService_
          .withTransaction(manager)
          .adjustReservedQuantity(
            data.inventory_item_id,
            data.location_id,
            data.quantity
          ),
      ])

      return newInventoryItem
    })

    await this.eventBusService_.emit(ReservationItemService.Events.CREATED, {
      id: result.id,
    })

    return result
  }

  /**
   * Update a reservation item.
   * @param {string} reservationItemId - The reservation item's id.
   * @param {DeepPartial<ReservationItem>} data - The reservation item data to update.
   * @returns {Promise<ReservationItem>} - The updated reservation item.
   */
  async update(
    reservationItemId: string,
    data: Omit<
      DeepPartial<ReservationItem>,
      "id" | "created_at" | "metadata" | "deleted_at"
    >
  ): Promise<ReservationItem> {
    const item = await this.atomicPhase_(async (manager) => {
      const itemRepository = manager.getRepository(ReservationItem)

      const item = await this.retrieve(reservationItemId)

      const shouldUpdateQuantity =
        isDefined(data.quantity) && data.quantity !== item.quantity

      const ops: Promise<unknown>[] = []
      if (shouldUpdateQuantity) {
        const quantityDiff = data.quantity! - item.quantity
        ops.push(
          this.inventoryLevelService_
            .withTransaction(manager)
            .adjustReservedQuantity(
              item.inventory_item_id,
              item.location_id,
              quantityDiff
            )
        )
      }

      itemRepository.merge(item, data)
      ops.push(itemRepository.save(item))

      await Promise.all(ops)

      return item
    })

    await this.eventBusService_.emit(ReservationItemService.Events.UPDATED, {
      id: item.id,
    })

    return item
  }

  /**
   * Deletes a reservation item by line item id.
   * @param {string} lineItemId - the id of the line item to delete.
   * @returns {Promise<void>} - an empty promise
   */
  async deleteByLineItem(lineItemId: string): Promise<void> {
    await this.atomicPhase_(async (manager) => {
      const itemRepository = manager.getRepository(ReservationItem)

      const items = await this.list({ line_item_id: lineItemId })

      const ops: Promise<unknown>[] = []
      for (const item of items) {
        ops.push(itemRepository.softRemove({ line_item_id: lineItemId }))
        ops.push(
          this.inventoryLevelService_
            .withTransaction(manager)
            .adjustReservedQuantity(
              item.inventory_item_id,
              item.location_id,
              item.quantity * -1
            )
        )
      }
      await Promise.all(ops)
    })

    await this.eventBusService_.emit(
      ReservationItemService.Events.DELETED_BY_LINE_ITEM,
      {
        line_item_id: lineItemId,
      }
    )
  }

  /**
   * Deletes a reservation item by id.
   * @param {string} reservationItemId - the id of the reservation item to delete.
   * @returns {Promise<void>} - an empty promise
   */
  async delete(reservationItemId: string): Promise<void> {
    await this.atomicPhase_(async (manager) => {
      const itemRepository = manager.getRepository(ReservationItem)
      const item = await this.retrieve(reservationItemId)

      await Promise.all([
        itemRepository.softRemove({ id: reservationItemId }),
        this.inventoryLevelService_
          .withTransaction(manager)
          .adjustReservedQuantity(
            item.inventory_item_id,
            item.location_id,
            item.quantity * -1
          ),
      ])
    })

    await this.eventBusService_.emit(ReservationItemService.Events.DELETED, {
      id: reservationItemId,
    })
  }
}