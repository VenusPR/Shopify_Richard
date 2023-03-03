import { isDefined, MedusaError } from "medusa-core-utils"
import {
  Brackets,
  EntityManager,
  FindManyOptions,
  FindOneOptions,
  FindOptionsSelect,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  SelectQueryBuilder,
} from "typeorm"
import {
  IPriceSelectionStrategy,
  PriceSelectionContext,
  TransactionBaseService,
} from "../interfaces"
import {
  MoneyAmount,
  Product,
  ProductOptionValue,
  ProductVariant,
} from "../models"
import { CartRepository } from "../repositories/cart"
import { MoneyAmountRepository } from "../repositories/money-amount"
import { ProductRepository } from "../repositories/product"
import { ProductOptionValueRepository } from "../repositories/product-option-value"
import {
  FindWithRelationsOptions,
  ProductVariantRepository,
} from "../repositories/product-variant"
import { FindConfig, WithRequiredProperty } from "../types/common"
import {
  CreateProductVariantInput,
  FilterableProductVariantProps,
  GetRegionPriceContext,
  ProductVariantPrice,
  UpdateProductVariantData,
  UpdateProductVariantInput,
  UpdateVariantPricesData,
} from "../types/product-variant"
import {
  buildQuery,
  buildRelations,
  isObject,
  isString,
  setMetadata,
} from "../utils"
import EventBusService from "./event-bus"
import RegionService from "./region"
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity"

class ProductVariantService extends TransactionBaseService {
  static Events = {
    UPDATED: "product-variant.updated",
    CREATED: "product-variant.created",
    DELETED: "product-variant.deleted",
  }

  protected readonly productVariantRepository_: typeof ProductVariantRepository
  protected readonly productRepository_: typeof ProductRepository
  protected readonly eventBus_: EventBusService
  protected readonly regionService_: RegionService
  protected readonly priceSelectionStrategy_: IPriceSelectionStrategy
  protected readonly moneyAmountRepository_: typeof MoneyAmountRepository
  // eslint-disable-next-line max-len
  protected readonly productOptionValueRepository_: typeof ProductOptionValueRepository
  protected readonly cartRepository_: typeof CartRepository

  constructor({
    productVariantRepository,
    productRepository,
    eventBusService,
    regionService,
    moneyAmountRepository,
    productOptionValueRepository,
    cartRepository,
    priceSelectionStrategy,
  }) {
    // eslint-disable-next-line prefer-rest-params
    super(arguments[0])

    this.productVariantRepository_ = productVariantRepository
    this.productRepository_ = productRepository
    this.eventBus_ = eventBusService
    this.regionService_ = regionService
    this.moneyAmountRepository_ = moneyAmountRepository
    this.productOptionValueRepository_ = productOptionValueRepository
    this.cartRepository_ = cartRepository
    this.priceSelectionStrategy_ = priceSelectionStrategy
  }

  /**
   * Gets a product variant by id.
   * @param variantId - the id of the product to get.
   * @param config - query config object for variant retrieval.
   * @return the product document.
   */
  async retrieve(
    variantId: string,
    config: FindConfig<ProductVariant> & PriceSelectionContext = {
      include_discount_prices: false,
    }
  ): Promise<ProductVariant> {
    const variantRepo = this.activeManager_.withRepository(
      this.productVariantRepository_
    )
    const query = buildQuery({ id: variantId }, config) as FindOneOptions
    const variant = await variantRepo.findOne(query)

    if (!variant) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Variant with id: ${variantId} was not found`
      )
    }

    return variant
  }

  /**
   * Gets a product variant by id.
   * @param sku - The unique stock keeping unit used to identify the product variant.
   * @param config - query config object for variant retrieval.
   * @return the product document.
   */
  async retrieveBySKU(
    sku: string,
    config: FindConfig<ProductVariant> & PriceSelectionContext = {
      include_discount_prices: false,
    }
  ): Promise<ProductVariant> {
    const variantRepo = this.activeManager_.withRepository(
      this.productVariantRepository_
    )

    const priceIndex = config.relations?.indexOf("prices") ?? -1
    if (priceIndex >= 0 && config.relations) {
      config.relations = [...config.relations]
      config.relations.splice(priceIndex, 1)
    }

    const query = buildQuery({ sku }, config) as FindOneOptions
    const variant = await variantRepo.findOne(query)

    if (!variant) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Variant with sku: ${sku} was not found`
      )
    }

    return variant
  }

  /**
   * Creates an unpublished product variant. Will validate against parent product
   * to ensure that the variant can in fact be created.
   * @param productOrProductId - the product the variant will be added to
   * @param variant - the variant to create
   * @return resolves to the creation result.
   */
  async create(
    productOrProductId: string | Product,
    variant: CreateProductVariantInput
  ): Promise<ProductVariant> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const productRepo = manager.withRepository(this.productRepository_)
      const variantRepo = manager.withRepository(this.productVariantRepository_)

      const { prices, ...rest } = variant

      let product = productOrProductId

      if (isString(product)) {
        product = (await productRepo.findOne({
          where: { id: productOrProductId as string },
          relations: buildRelations([
            "variants",
            "variants.options",
            "options",
          ]),
        })) as Product
      } else if (!product.id) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Product id missing`
        )
      }

      if (product.options.length !== variant.options.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Product options length does not match variant options length. Product has ${product.options.length} and variant has ${variant.options.length}.`
        )
      }

      product.options.forEach((option) => {
        if (!variant.options.find((vo) => option.id === vo.option_id)) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Variant options do not contain value for ${option.title}`
          )
        }
      })

      const variantExists = product.variants.find((v) => {
        return v.options.every((option) => {
          const variantOption = variant.options.find(
            (o) => option.option_id === o.option_id
          )

          return option.value === variantOption?.value
        })
      })

      if (variantExists) {
        throw new MedusaError(
          MedusaError.Types.DUPLICATE_ERROR,
          `Variant with title ${variantExists.title} with provided options already exists`
        )
      }

      if (!rest.variant_rank) {
        rest.variant_rank = product.variants.length
      }

      const toCreate = {
        ...rest,
        product_id: product.id,
      }

      const productVariant = variantRepo.create(toCreate)

      const result = await variantRepo.save(productVariant)

      if (prices) {
        await this.updateVariantPrices([
          {
            variantId: result.id,
            prices,
          },
        ])
      }

      await this.eventBus_
        .withTransaction(manager)
        .emit(ProductVariantService.Events.CREATED, {
          id: result.id,
          product_id: result.product_id,
        })

      return result
    })
  }

  /**
   * Updates a collection of variant.
   * @param variantData - a collection of variant and the data to update.
   * @return resolves to the update result.
   */
  async update(
    variantData: {
      variant: ProductVariant
      updateData: UpdateProductVariantInput
    }[]
  ): Promise<ProductVariant[]>

  /**
   * Updates a variant.
   * Price updates should use dedicated methods.
   * The function will throw, if price updates are attempted.
   * @param variantOrVariantId - variant or id of a variant.
   * @param update - an object with the update values.
   * @return resolves to the update result.
   */
  async update(
    variantOrVariantId: string | Partial<ProductVariant>,
    update: UpdateProductVariantInput
  ): Promise<ProductVariant>

  async update<
    TInput extends string | Partial<ProductVariant> | UpdateProductVariantData
  >(
    variantOrVariantIdOrData: TInput,
    update?: UpdateProductVariantInput
  ): Promise<
    TInput extends UpdateProductVariantData ? ProductVariant[] : ProductVariant
  > {
    let res: TInput extends UpdateProductVariantData
      ? ProductVariant[]
      : ProductVariant

    if (update) {
      res = (await this.updateLegacy(
        variantOrVariantIdOrData,
        update
      )) as TInput extends UpdateProductVariantData
        ? ProductVariant[]
        : ProductVariant
    } else {
      res = (await this.updateBatch(
        variantOrVariantIdOrData as {
          variant: ProductVariant
          updateData: UpdateProductVariantInput
        }[]
      )) as TInput extends UpdateProductVariantData
        ? ProductVariant[]
        : ProductVariant
    }

    return res
  }

  /**
   * @deprecated in favour of updateBatch
   * @param variantOrVariantId
   * @param update
   * @protected
   */
  protected async updateLegacy(
    variantOrVariantId: string | Partial<ProductVariant>,
    update: UpdateProductVariantInput
  ): Promise<ProductVariant> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const variantRepo = manager.withRepository(this.productVariantRepository_)

      let variant = variantOrVariantId
      if (typeof variant === `string`) {
        const variantRes = await variantRepo.findOne({
          where: { id: variantOrVariantId as string },
        })
        if (!isDefined(variantRes)) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `Variant with id ${variantOrVariantId} was not found`
          )
        } else {
          variant = variantRes as ProductVariant
        }
      } else if (!variant.id) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Variant id missing`
        )
      }

      const { prices, options, metadata, inventory_quantity, ...rest } = update

      if (prices) {
        await this.updateVariantPrices(variant.id!, prices)
      }

      if (options) {
        for (const option of options) {
          await this.updateOptionValue(
            variant.id!,
            option.option_id,
            option.value
          )
        }
      }

      if (typeof metadata === "object") {
        variant.metadata = setMetadata(variant as ProductVariant, metadata)
      }

      if (typeof inventory_quantity === "number") {
        variant.inventory_quantity = inventory_quantity as number
      }

      for (const [key, value] of Object.entries(rest)) {
        variant[key] = value
      }

      const result = await variantRepo.save(variant)

      await this.eventBus_
        .withTransaction(manager)
        .emit(ProductVariantService.Events.UPDATED, {
          id: result.id,
          product_id: result.product_id,
          fields: Object.keys(update),
        })

      return result
    })
  }

  protected async updateBatch(
    variantData: {
      variant: ProductVariant
      updateData: UpdateProductVariantInput
    }[]
  ): Promise<ProductVariant[]> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const variantRepo = manager.withRepository(this.productVariantRepository_)

      const variantPriceUpdateData = variantData
        .filter((data) => isDefined(data.updateData.prices))
        .map((data) => ({
          variantId: data.variant.id,
          prices: data.updateData.prices!,
        }))

      if (variantPriceUpdateData.length) {
        await this.updateVariantPrices(variantPriceUpdateData)
      }

      const results: [ProductVariant, UpdateProductVariantInput][] =
        await Promise.all(
          variantData.map(async (data) => {
            const variant = data.variant

            const { prices, options, metadata, inventory_quantity, ...rest } =
              data.updateData

            if (options) {
              for (const option of options) {
                await this.updateOptionValue(
                  variant.id!,
                  option.option_id,
                  option.value
                )
              }
            }

            if (isObject(metadata)) {
              variant.metadata = setMetadata(
                variant as ProductVariant,
                metadata
              )
            }

            if (typeof inventory_quantity === "number") {
              variant.inventory_quantity = inventory_quantity as number
            }

            for (const [key, value] of Object.entries(rest)) {
              variant[key] = value
            }

            const result = await variantRepo.save(variant)
            return [result, data.updateData]
          })
        )

      const eventBusServiceTx = this.eventBus_.withTransaction(manager)

      await Promise.all(
        results.map(async ([result, updatedData]) =>
          eventBusServiceTx.emit(ProductVariantService.Events.UPDATED, {
            id: result.id,
            product_id: result.product_id,
            fields: Object.keys(updatedData),
          })
        )
      )

      return results.map(([variant]) => variant)
    })
  }

  /**
   * Updates variant/prices collection.
   * Deletes any prices that are not in the update object, and is not associated with a price list.
   * @param data
   * @returns empty promise
   */
  async updateVariantPrices(data: UpdateVariantPricesData): Promise<void>

  /**
   * Updates a variant's prices.
   * Deletes any prices that are not in the update object, and is not associated with a price list.
   * @param variantId - the id of variant
   * @param prices - the update prices
   * @returns empty promise
   */
  async updateVariantPrices(
    variantId: string,
    prices: ProductVariantPrice[]
  ): Promise<void>

  async updateVariantPrices(
    variantIdOrData: string | UpdateVariantPricesData,
    prices?: ProductVariantPrice[]
  ): Promise<void> {
    let res

    if (prices && isString(variantIdOrData)) {
      res = await this.updateVariantPricesLegacy(variantIdOrData, prices)
    } else {
      res = await this.updateVariantPricesBatch(
        variantIdOrData as UpdateVariantPricesData
      )
    }

    return res
  }

  /**
   * @deprecated in favour or updateVariantPricesBatch
   * Updates a variant's prices.
   * Deletes any prices that are not in the update object, and is not associated with a price list.
   * @param variantId - the id of variant
   * @param prices - the update prices
   * @returns empty promise
   */
  protected async updateVariantPricesLegacy(
    variantId: string,
    prices: ProductVariantPrice[]
  ): Promise<void> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const moneyAmountRepo = manager.withRepository(
        this.moneyAmountRepository_
      )

      // Delete obsolete prices
      await moneyAmountRepo.deleteVariantPricesNotIn(variantId, prices)

      const regionsServiceTx = this.regionService_.withTransaction(manager)

      for (const price of prices) {
        if (price.region_id) {
          const region = await regionsServiceTx.retrieve(price.region_id)

          await this.setRegionPrice(variantId, {
            currency_code: region.currency_code,
            region_id: price.region_id,
            amount: price.amount,
          })
        } else {
          await this.setCurrencyPrice(variantId, price)
        }
      }
    })
  }

  protected async updateVariantPricesBatch(
    data: { variantId: string; prices: ProductVariantPrice[] }[]
  ): Promise<void> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const moneyAmountRepo = manager.withRepository(
        this.moneyAmountRepository_
      )

      // Delete obsolete prices
      await moneyAmountRepo.deleteVariantPricesNotInNew(data)

      const regionIdsSet = new Set(
        data
          .map((data_) =>
            data_.prices.map((price) => price.region_id).filter(Boolean)
          )
          .flat()
      )

      const regions = await this.regionService_.withTransaction(manager).list(
        {
          id: In([...regionIdsSet]),
        },
        {
          select: ["id", "currency_code"],
        }
      )

      const regionsMap = new Map(regions.map((r) => [r.id, r]))

      const dataRegionPrices: {
        variantId: string
        price: {
          currency_code: string
          region_id: string
          amount: number
        }
      }[] = []
      const dataCurrencyPrices: {
        variantId: string
        price: WithRequiredProperty<ProductVariantPrice, "currency_code">
      }[] = []

      data.forEach(({ prices, variantId }) => {
        prices.forEach((price) => {
          if (price.region_id) {
            const region = regionsMap.get(price.region_id)!
            dataRegionPrices.push({
              variantId,
              price: {
                currency_code: region.currency_code,
                region_id: price.region_id,
                amount: price.amount,
              },
            })
          } else {
            dataCurrencyPrices.push({
              variantId,
              price: { ...price, currency_code: price.currency_code! },
            })
          }
        })
      })

      const promises: Promise<any>[] = []

      if (dataRegionPrices.length) {
        promises.push(this.addOrUpdateRegionPrices(dataRegionPrices))
      }

      if (dataCurrencyPrices.length) {
        promises.push(this.addOrUpdateCurrencyPrices(dataCurrencyPrices))
      }

      await Promise.all(promises)
    })
  }

  /**
   * Gets the price specific to a region. If no region specific money amount
   * exists the function will try to use a currency price. If no default
   * currency price exists the function will throw an error.
   * @param variantId - the id of the variant to get price from
   * @param context - context for getting region price
   * @return the price specific to the region
   */
  async getRegionPrice(
    variantId: string,
    context: GetRegionPriceContext
  ): Promise<number | null> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const region = await this.regionService_
        .withTransaction(manager)
        .retrieve(context.regionId)

      const prices = await this.priceSelectionStrategy_
        .withTransaction(manager)
        .calculateVariantPrice(variantId, {
          region_id: context.regionId,
          currency_code: region.currency_code,
          quantity: context.quantity,
          customer_id: context.customer_id,
          include_discount_prices: !!context.include_discount_prices,
        })

      return prices.calculatedPrice
    })
  }

  /**
   * Sets the default price of a specific region
   * @param variantId - the id of the variant to update
   * @param price - the price for the variant.
   * @return the result of the update operation
   */
  async setRegionPrice(
    variantId: string,
    price: ProductVariantPrice
  ): Promise<MoneyAmount> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const moneyAmountRepo = manager.withRepository(
        this.moneyAmountRepository_
      )

      let moneyAmount = await moneyAmountRepo.findOne({
        where: {
          variant_id: variantId,
          region_id: price.region_id,
          price_list_id: IsNull(),
        },
      })

      if (!moneyAmount) {
        moneyAmount = moneyAmountRepo.create({
          ...price,
          variant_id: variantId,
        })
      } else {
        moneyAmount.amount = price.amount
      }

      return await moneyAmountRepo.save(moneyAmount)
    })
  }

  async addOrUpdateRegionPrices(
    data: {
      variantId: string
      price: {
        currency_code: string
        region_id: string
        amount: number
      }
    }[]
  ): Promise<MoneyAmount[]> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const moneyAmountRepo = manager.withRepository(
        this.moneyAmountRepository_
      )

      const where = data.map((data_) => ({
        variant_id: data_.variantId,
        region_id: data_.price.region_id,
        price_list_id: IsNull(),
      }))

      const moneyAmounts = await moneyAmountRepo.find({
        where,
      })

      const moneyAmountsMapToVariantId = new Map()
      moneyAmounts.map((d) => {
        const moneyAmounts = moneyAmountsMapToVariantId.get(d.variant_id) ?? []
        moneyAmounts.push(d)
        moneyAmountsMapToVariantId.set(d.variant_id, moneyAmounts)
      })

      const dataToCreate: QueryDeepPartialEntity<MoneyAmount>[] = []
      const dataToUpdate: MoneyAmount[] = []

      data.forEach(({ price, variantId }) => {
        const variantMoneyAmounts =
          moneyAmountsMapToVariantId.get(variantId) ?? []

        const moneyAmount = variantMoneyAmounts.find(
          (ma) => ma.region_id === price.region_id
        )

        if (moneyAmount) {
          dataToUpdate.push({
            ...moneyAmount,
            amount: price.amount,
          })
        } else {
          dataToCreate.push(
            moneyAmountRepo.create({
              ...price,
              variant_id: variantId,
            }) as QueryDeepPartialEntity<MoneyAmount>
          )
        }
      })

      return (
        await Promise.all([
          moneyAmountRepo.insertBulk(dataToCreate),
          moneyAmountRepo.save(dataToUpdate),
        ])
      ).flat() as MoneyAmount[]
    })
  }

  async addOrUpdateCurrencyPrices(
    data: {
      variantId: string
      price: WithRequiredProperty<ProductVariantPrice, "currency_code">
    }[]
  ): Promise<MoneyAmount[]> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const moneyAmountRepo = manager.withRepository(
        this.moneyAmountRepository_
      )

      const where = data.map((data_) => ({
        variant_id: data_.variantId,
        currency_code: data_.price.currency_code,
        region_id: IsNull(),
        price_list_id: IsNull(),
      }))

      const moneyAmounts = await moneyAmountRepo.find({
        where,
      })

      const moneyAmountsMapToVariantId = new Map()
      moneyAmounts.map((d) => {
        const moneyAmounts = moneyAmountsMapToVariantId.get(d.variant_id) ?? []
        moneyAmounts.push(d)
        moneyAmountsMapToVariantId.set(d.variant_id, moneyAmounts)
      })

      const dataToCreate: QueryDeepPartialEntity<MoneyAmount>[] = []
      const dataToUpdate: MoneyAmount[] = []

      data.forEach((data_) => {
        const variantMoneyAmounts =
          moneyAmountsMapToVariantId.get(data_.variantId) ?? []

        const hasMoneyAmount = variantMoneyAmounts.find(
          (ma) => ma.currency_code === data_.price.currency_code
        )

        if (hasMoneyAmount) {
          dataToUpdate.push({
            ...hasMoneyAmount,
            amount: data_.price.amount,
          })
        } else {
          dataToCreate.push(
            moneyAmountRepo.create({
              ...data_.price,
              variant_id: data_.variantId,
              currency_code: data_.price.currency_code,
            }) as QueryDeepPartialEntity<MoneyAmount>
          )
        }
      })

      const promises: Promise<any>[] = []

      if (dataToCreate.length) {
        const queryBuilder = moneyAmountRepo.createQueryBuilder()
        promises.push(
          queryBuilder
            .insert()
            .into(MoneyAmount)
            .values(dataToCreate)
            .returning("*")
            .execute()
        )
      }

      if (dataToUpdate.length) {
        promises.push(moneyAmountRepo.save(dataToUpdate))
      }

      return (await Promise.all(promises)).flat() as MoneyAmount[]
    })
  }

  /**
   * Sets the default price for the given currency.
   * @param variantId - the id of the variant to set prices for
   * @param price - the price for the variant
   * @return the result of the update operation
   */
  async setCurrencyPrice(
    variantId: string,
    price: ProductVariantPrice
  ): Promise<MoneyAmount> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const moneyAmountRepo = manager.withRepository(
        this.moneyAmountRepository_
      )

      return await moneyAmountRepo.upsertVariantCurrencyPrice(variantId, price)
    })
  }

  /**
   * Updates variant's option value.
   * Option value must be of type string or number.
   * @param variantId - the variant to decorate.
   * @param optionId - the option from product.
   * @param optionValue - option value to add.
   * @return the result of the update operation.
   */
  async updateOptionValue(
    variantId: string,
    optionId: string,
    optionValue: string
  ): Promise<ProductOptionValue> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const productOptionValueRepo = manager.withRepository(
        this.productOptionValueRepository_
      )

      const productOptionValue = await productOptionValueRepo.findOne({
        where: { variant_id: variantId, option_id: optionId },
      })

      if (!productOptionValue) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Product option value not found`
        )
      }

      productOptionValue.value = optionValue

      return await productOptionValueRepo.save(productOptionValue)
    })
  }

  /**
   * Adds option value to a variant.
   * Fails when product with variant does not exist or
   * if that product does not have an option with the given
   * option id. Fails if given variant is not found.
   * Option value must be of type string or number.
   * @param variantId - the variant to decorate.
   * @param optionId - the option from product.
   * @param optionValue - option value to add.
   * @return the result of the update operation.
   */
  async addOptionValue(
    variantId: string,
    optionId: string,
    optionValue: string
  ): Promise<ProductOptionValue> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const productOptionValueRepo = manager.withRepository(
        this.productOptionValueRepository_
      )

      const productOptionValue = productOptionValueRepo.create({
        variant_id: variantId,
        option_id: optionId,
        value: optionValue,
      })

      return await productOptionValueRepo.save(productOptionValue)
    })
  }

  /**
   * Deletes option value from given variant.
   * Will never fail due to delete being idempotent.
   * @param variantId - the variant to decorate.
   * @param optionId - the option from product.
   * @return empty promise
   */
  async deleteOptionValue(variantId: string, optionId: string): Promise<void> {
    return await this.atomicPhase_(async (manager: EntityManager) => {
      const productOptionValueRepo = manager.withRepository(
        this.productOptionValueRepository_
      )

      const productOptionValue = await productOptionValueRepo.findOne({
        where: {
          variant_id: variantId,
          option_id: optionId,
        },
      })

      if (!productOptionValue) {
        return Promise.resolve()
      }

      await productOptionValueRepo.softRemove(productOptionValue)

      return Promise.resolve()
    })
  }

  /**
   * @param selector - the query object for find
   * @param config - query config object for variant retrieval
   * @return the result of the find operation
   */
  async listAndCount(
    selector: FilterableProductVariantProps,
    config: FindConfig<ProductVariant> & PriceSelectionContext = {
      relations: [],
      skip: 0,
      take: 20,
      include_discount_prices: false,
    }
  ): Promise<[ProductVariant[], number]> {
    const variantRepo = this.activeManager_.withRepository(
      this.productVariantRepository_
    )

    let q
    if (isDefined(selector.q)) {
      q = selector.q
      delete selector.q
    }

    const query = buildQuery<FindOptionsSelect<ProductVariant>, ProductVariant>(
      selector as FindOptionsSelect<ProductVariant>,
      config
    )
    query.relationLoadStrategy = "query"

    if (q) {
      query.relations = query.relations ?? {}
      query.relations["product"] = query.relations["product"] ?? true

      query.where = query.where as FindOptionsWhere<ProductVariant>
      delete query.where?.title

      query.where = query.where ?? {}
      query.where = [
        {
          ...query.where,
          title: ILike(`%${q}%`),
        },
        {
          ...query.where,
          sku: ILike(`%${q}%`),
        },
        {
          ...query.where,
          product: {
            ...((query.where.product ??
              {}) as FindOptionsWhere<ProductVariant>),
            title: ILike(`%${q}%`),
          },
        },
      ]
    }

    return await variantRepo.findAndCount(query)
  }

  /**
   * @param selector - the query object for find
   * @param config - query config object for variant retrieval
   * @return the result of the find operation
   */
  async list(
    selector: FilterableProductVariantProps,
    config: FindConfig<ProductVariant> & PriceSelectionContext = {
      relations: [],
      skip: 0,
      take: 20,
    }
  ): Promise<ProductVariant[]> {
    const productVariantRepo = this.activeManager_.withRepository(
      this.productVariantRepository_
    )

    const priceIndex = config.relations?.indexOf("prices") ?? -1
    if (priceIndex >= 0 && config.relations) {
      config.relations = [...config.relations]
      config.relations.splice(priceIndex, 1)
    }

    let q: string | undefined
    if ("q" in selector) {
      q = selector.q
      delete selector.q
    }

    const query = buildQuery(selector, config) as FindManyOptions

    if (q) {
      const where = query.where as FindOptionsWhere<ProductVariant>

      delete where?.sku
      delete where?.title

      query.relations = query.relations || {}
      query.relations["product"] = true

      query.where = (qb: SelectQueryBuilder<ProductVariant>): void => {
        qb.where(where).andWhere([
          { sku: ILike(`%${q}%`) },
          { title: ILike(`%${q}%`) },
          { product: { title: ILike(`%${q}%`) } },
        ])
      }
    }

    return await productVariantRepo.find(query)
  }

  /**
   * Deletes variant or variants.
   * Will never fail due to delete being idempotent.
   * @param variantIds - the id of the variant to delete. Must be
   *   castable as an ObjectId
   * @return empty promise
   */
  async delete(variantIds: string | string[]): Promise<void> {
    const variantIds_ = isString(variantIds) ? [variantIds] : variantIds

    return await this.atomicPhase_(async (manager: EntityManager) => {
      const variantRepo = manager.withRepository(this.productVariantRepository_)

      const variants = await variantRepo.find({
        where: { id: In(variantIds_) },
        relations: ["prices", "options", "inventory_items"],
      })

      if (!variants.length) {
        return Promise.resolve()
      }

      await variantRepo.softRemove(variants)

      await Promise.all(
        variants.map(async (variant) =>
          this.eventBus_
            .withTransaction(manager)
            .emit(ProductVariantService.Events.DELETED, {
              id: variant.id,
              product_id: variant.product_id,
              metadata: variant.metadata,
            })
        )
      )
    })
  }

  /**
   * Check if the variant is assigned to at least one of the provided sales channels.
   *
   * @param id - product variant id
   * @param salesChannelIds - an array of sales channel ids
   */
  async isVariantInSalesChannels(
    id: string,
    salesChannelIds: string[]
  ): Promise<boolean> {
    const variant = await this.retrieve(id, {
      relations: ["product", "product.sales_channels"],
    })

    // TODO: reimplement this to use db level check
    const productsSalesChannels = variant.product.sales_channels.map(
      (channel) => channel.id
    )

    return productsSalesChannels.some((id) => salesChannelIds.includes(id))
  }

  /**
   * Lists variants based on the provided parameters and includes the count of
   * variants that match the query.
   * @param variantRepo - the variant repository
   * @param query - object that defines the scope for what should be returned
   * @param q - free text query
   * @return an array containing the products as the first element and the total
   *   count of products that matches the query as the second element.
   */
  getFreeTextQueryBuilder_(
    variantRepo: typeof ProductVariantRepository,
    query: FindWithRelationsOptions,
    q?: string
  ): SelectQueryBuilder<ProductVariant> {
    const where = query.where

    if (typeof where === "object") {
      if ("title" in where) {
        delete where.title
      }
    }

    let qb = variantRepo
      .createQueryBuilder("pv")
      .take(query.take)
      .skip(Math.max(query.skip ?? 0, 0))
      .leftJoinAndSelect("pv.product", "product")
      .select(["pv.id"])
      .where(where!)
      .andWhere(
        new Brackets((qb) => {
          qb.where(`product.title ILIKE :q`, { q: `%${q}%` })
            .orWhere(`pv.title ILIKE :q`, { q: `%${q}%` })
            .orWhere(`pv.sku ILIKE :q`, { q: `%${q}%` })
        })
      )

    if (query.withDeleted) {
      qb = qb.withDeleted()
    }

    return qb
  }
}

export default ProductVariantService
