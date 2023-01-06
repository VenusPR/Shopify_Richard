import { MedusaError } from "medusa-core-utils"
import {
  FindConfig,
  IInventoryService,
  FilterableInventoryItemProps,
  FilterableReservationItemProps,
  CreateInventoryItemInput,
  CreateReservationItemInput,
  FilterableInventoryLevelProps,
  CreateInventoryLevelInput,
  UpdateInventoryLevelInput,
  UpdateReservationItemInput,
  IEventBusService,
  InventoryItemDTO,
  ReservationItemDTO,
  InventoryLevelDTO,
} from "@medusajs/medusa"

import {
  InventoryItemService,
  ReservationItemService,
  InventoryLevelService,
} from "./"

type InjectedDependencies = {
  eventBusService: IEventBusService
}

export default class InventoryService implements IInventoryService {
  protected readonly eventBusService_: IEventBusService
  protected readonly inventoryItemService_: InventoryItemService
  protected readonly reservationItemService_: ReservationItemService
  protected readonly inventoryLevelService_: InventoryLevelService

  constructor({ eventBusService }: InjectedDependencies) {
    this.eventBusService_ = eventBusService

    this.inventoryItemService_ = new InventoryItemService({ eventBusService })
    this.inventoryLevelService_ = new InventoryLevelService({
      eventBusService,
    })
    this.reservationItemService_ = new ReservationItemService({
      eventBusService,
      inventoryLevelService: this.inventoryLevelService_,
    })
  }

  /**
   * Lists inventory items that match the given selector
   * @param {FilterableInventoryItemProps} selector - the selector to filter inventory items by
   * @param {FindConfig<InventoryItemDTO>} [config={ relations: [], skip: 0, take: 10 }] - the find configuration to use
   * @returns {Promise<[InventoryItemDTO[], number]>} a tuple of inventory items and their total count
   */
  async listInventoryItems(
    selector: FilterableInventoryItemProps,
    config: FindConfig<InventoryItemDTO> = { relations: [], skip: 0, take: 10 }
  ): Promise<[InventoryItemDTO[], number]> {
    return await this.inventoryItemService_.listAndCount(selector, config)
  }

  /**
   * Lists inventory levels that match the given selector
   * @param {FilterableInventoryLevelProps} selector - the selector to filter inventory levels by
   * @param {FindConfig<InventoryLevelDTO>} [config={ relations: [], skip: 0, take: 10 }] - the find configuration to use
   * @returns {Promise<[InventoryLevelDTO[], number]>} a tuple of inventory levels and their total count
   */
  async listInventoryLevels(
    selector: FilterableInventoryLevelProps,
    config: FindConfig<InventoryLevelDTO> = { relations: [], skip: 0, take: 10 }
  ): Promise<[InventoryLevelDTO[], number]> {
    return await this.inventoryLevelService_.listAndCount(selector, config)
  }

  /**
   * Lists reservation items that match the given selector
   * @param {FilterableReservationItemProps} selector - the selector to filter reservation items by
   * @param {FindConfig<ReservationItemDTO>} [config={ relations: [], skip: 0, take: 10 }] - the find configuration to use
   * @returns {Promise<[ReservationItemDTO[], number]>} a tuple of reservation items and their total count
   */
  async listReservationItems(
    selector: FilterableReservationItemProps,
    config: FindConfig<ReservationItemDTO> = {
      relations: [],
      skip: 0,
      take: 10,
    }
  ): Promise<[ReservationItemDTO[], number]> {
    return await this.reservationItemService_.listAndCount(selector, config)
  }

  /**
   * Retrieves an inventory item with the given id
   * @param {string} inventoryItemId - the id of the inventory item to retrieve
   * @param {FindConfig<InventoryItemDTO>} [config] - the find configuration to use
   * @returns {Promise<InventoryItemDTO>} the retrieved inventory item
   */
  async retrieveInventoryItem(
    inventoryItemId: string,
    config?: FindConfig<InventoryItemDTO>
  ): Promise<InventoryItemDTO> {
    const inventoryItem = await this.inventoryItemService_.retrieve(
      inventoryItemId,
      config
    )
    return { ...inventoryItem }
  }

  /**
   * Retrieves an inventory level for a given inventory item and location
   * @param {string} inventoryItemId - the id of the inventory item
   * @param {string} locationId - the id of the location
   * @returns {Promise<InventoryLevelDTO>} the retrieved inventory level
   */
  async retrieveInventoryLevel(
    inventoryItemId: string,
    locationId: string
  ): Promise<InventoryLevelDTO> {
    const [inventoryLevel] = await this.inventoryLevelService_.list(
      { inventory_item_id: inventoryItemId, location_id: locationId },
      { take: 1 }
    )
    if (!inventoryLevel) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory level for item ${inventoryItemId} and location ${locationId} not found`
      )
    }
    return inventoryLevel
  }

  /**
   * Creates a reservation item
   * @param {CreateReservationItemInput} input - the input object
   * @return {Promise<ReservationItemDTO>} - the created reservation item
   */
  async createReservationItem(
    input: CreateReservationItemInput
  ): Promise<ReservationItemDTO> {
    // Verify that the item is stocked at the location
    const [inventoryLevel] = await this.inventoryLevelService_.list(
      {
        inventory_item_id: input.inventory_item_id,
        location_id: input.location_id,
      },
      { take: 1 }
    )

    if (!inventoryLevel) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Item ${input.inventory_item_id} is not stocked at location ${input.location_id}`
      )
    }

    const reservationItem = await this.reservationItemService_.create(input)

    return { ...reservationItem }
  }

  /**
   * Creates an inventory item
   * @param {CreateInventoryItemInput} input - the input object
   * @return {Promise<InventoryItemDTO>} - the created inventory item
   */
  async createInventoryItem(
    input: CreateInventoryItemInput
  ): Promise<InventoryItemDTO> {
    const inventoryItem = await this.inventoryItemService_.create(input)
    return { ...inventoryItem }
  }

  /**
   * Creates an inventory item
   * @param {CreateInventoryItemInput} input - the input object
   * @return {Promise<InventoryItemDTO>} - the created inventory item
   */
  async createInventoryLevel(
    input: CreateInventoryLevelInput
  ): Promise<InventoryLevelDTO> {
    return await this.inventoryLevelService_.create(input)
  }

  /**
   * Updates an inventory item
   * @param {string} inventoryItemId - the id of the inventory item to update
   * @param {Partial<CreateInventoryItemInput>} input - the input object
   * @return {Promise<InventoryItemDTO>} - the updated inventory item
   */
  async updateInventoryItem(
    inventoryItemId: string,
    input: Partial<CreateInventoryItemInput>
  ): Promise<InventoryItemDTO> {
    const inventoryItem = await this.inventoryItemService_.update(
      inventoryItemId,
      input
    )
    return { ...inventoryItem }
  }

  /**
   * Deletes an inventory item
   * @param {string} inventoryItemId - the id of the inventory item to delete
   * @return {Promise<void>} - a promise that resolves when the item is deleted
   */
  async deleteInventoryItem(inventoryItemId: string): Promise<void> {
    return await this.inventoryItemService_.delete(inventoryItemId)
  }

  /**
   * Deletes an inventory level
   * @param {string} inventoryItemId - the id of the inventory item associated with the level
   * @param {string} locationId - the id of the location associated with the level
   * @return {Promise<void>} - a promise that resolves when the level is deleted
   */
  async deleteInventoryLevel(
    inventoryItemId: string,
    locationId: string
  ): Promise<void> {
    const [inventoryLevel] = await this.inventoryLevelService_.list(
      { inventory_item_id: inventoryItemId, location_id: locationId },
      { take: 1 }
    )

    if (!inventoryLevel) {
      return
    }

    return await this.inventoryLevelService_.delete(inventoryLevel.id)
  }

  /**
   * Updates an inventory level
   * @param {string} inventoryItemId - the id of the inventory item associated with the level
   * @param {string} locationId - the id of the location associated with the level
   * @param {UpdateInventoryLevelInput} input - the input object
   * @return {Promise<InventoryLevelDTO>} - the updated inventory level
   */
  async updateInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    input: UpdateInventoryLevelInput
  ): Promise<InventoryLevelDTO> {
    const [inventoryLevel] = await this.inventoryLevelService_.list(
      { inventory_item_id: inventoryItemId, location_id: locationId },
      { take: 1 }
    )

    if (!inventoryLevel) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory level for item ${inventoryItemId} and location ${locationId} not found`
      )
    }

    return await this.inventoryLevelService_.update(inventoryLevel.id, input)
  }

  /**
   * Updates a reservation item
   * @param {string} inventoryItemId - the id of the inventory item associated with the level
   * @param {UpdateReservationItemInput} input - the input object
   * @return {Promise<InventoryLevelDTO>} - the updated inventory level
   */
  async updateReservationItem(
    reservationItemId: string,
    input: UpdateReservationItemInput
  ): Promise<ReservationItemDTO> {
    return await this.reservationItemService_.update(reservationItemId, input)
  }

  /**
   * Deletes reservation items by line item
   * @param {string} lineItemId - the id of the line item associated with the reservation item
   * @return {Promise<void>} - a promise that resolves when the reservation items are deleted
   */
  async deleteReservationItemsByLineItem(lineItemId: string): Promise<void> {
    return await this.reservationItemService_.deleteByLineItem(lineItemId)
  }

  /**
   * Deletes a reservation item
   * @param {string} reservationItemId - the id of the reservation item to delete
   * @return {Promise<void>} - a promise that resolves when the item is deleted
   */
  async deleteReservationItem(reservationItemId: string): Promise<void> {
    return await this.reservationItemService_.delete(reservationItemId)
  }

  /**
   * Adjusts the inventory level for a given inventory item and location.
   * @param {string} inventoryItemId - the id of the inventory item
   * @param {string} locationId - the id of the location
   * @param {number} adjustment - the number to adjust the inventory by (can be positive or negative)
   * @returns {Promise<InventoryLevelDTO>} the updated inventory level
   * @throws {MedusaError} when the inventory level is not found
   */
  async adjustInventory(
    inventoryItemId: string,
    locationId: string,
    adjustment: number
  ): Promise<InventoryLevelDTO> {
    const [inventoryLevel] = await this.inventoryLevelService_.list(
      { inventory_item_id: inventoryItemId, location_id: locationId },
      { take: 1 }
    )
    if (!inventoryLevel) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory level for inventory item ${inventoryItemId} and location ${locationId} not found`
      )
    }

    const updatedInventoryLevel = await this.inventoryLevelService_.update(
      inventoryLevel.id,
      {
        stocked_quantity: inventoryLevel.stocked_quantity + adjustment,
      }
    )

    return { ...updatedInventoryLevel }
  }

  /**
   * Retrieves the available quantity of a given inventory item in a given location.
   * @param {string} inventoryItemId - the id of the inventory item
   * @param {string[]} locationIds - the ids of the locations to check
   * @returns {Promise<number>} the available quantity
   * @throws {MedusaError} when the inventory item is not found
   */
  async retrieveAvailableQuantity(
    inventoryItemId: string,
    locationIds: string[]
  ): Promise<number> {
    // Throws if item does not exist
    await this.inventoryItemService_.retrieve(inventoryItemId, {
      select: ["id"],
    })

    const availableQuantity =
      await this.inventoryLevelService_.getAvailableQuantity(
        inventoryItemId,
        locationIds
      )

    return availableQuantity
  }

  /**
   * Retrieves the stocked quantity of a given inventory item in a given location.
   * @param {string} inventoryItemId - the id of the inventory item
   * @param {string[]} locationIds - the ids of the locations to check
   * @returns {Promise<number>} the stocked quantity
   * @throws {MedusaError} when the inventory item is not found
   */
  async retrieveStockedQuantity(
    inventoryItemId: string,
    locationIds: string[]
  ): Promise<number> {
    // Throws if item does not exist
    await this.inventoryItemService_.retrieve(inventoryItemId, {
      select: ["id"],
    })

    const stockedQuantity =
      await this.inventoryLevelService_.getStockedQuantity(
        inventoryItemId,
        locationIds
      )

    return stockedQuantity
  }

  /**
   * Retrieves the reserved quantity of a given inventory item in a given location.
   * @param {string} inventoryItemId - the id of the inventory item
   * @param {string[]} locationIds - the ids of the locations to check
   * @returns {Promise<number>} the reserved quantity
   * @throws {MedusaError} when the inventory item is not found
   */
  async retrieveReservedQuantity(
    inventoryItemId: string,
    locationIds: string[]
  ): Promise<number> {
    // Throws if item does not exist
    await this.inventoryItemService_.retrieve(inventoryItemId, {
      select: ["id"],
    })

    const reservedQuantity =
      await this.inventoryLevelService_.getReservedQuantity(
        inventoryItemId,
        locationIds
      )

    return reservedQuantity
  }

  /**
   * Confirms whether there is sufficient inventory for a given quantity of a given inventory item in a given location.
   * @param {string} inventoryItemId - the id of the inventory item
   * @param {string[]} locationIds - the ids of the locations to check
   * @param {number} quantity - the quantity to check
   * @returns {Promise<boolean>} whether there is sufficient inventory
   */
  async confirmInventory(
    inventoryItemId: string,
    locationIds: string[],
    quantity: number
  ): Promise<boolean> {
    const availableQuantity = await this.retrieveAvailableQuantity(
      inventoryItemId,
      locationIds
    )
    return availableQuantity >= quantity
  }
}