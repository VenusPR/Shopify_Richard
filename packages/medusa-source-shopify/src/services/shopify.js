import { MedusaError } from "medusa-core-utils"
import { BaseService } from "medusa-interfaces"
import { fetchProduct, fetchShopify } from "../utils/fetch-shopify"
import { parsePrice } from "../utils/parse-price"
import { removeIndex } from "../utils/remove-index"

class ShopifyService extends BaseService {
  constructor(
    {
      manager,
      productService,
      productVariantService,
      productCollectionService,
      shippingProfileService,
      customerService,
      orderService,
      regionService,
      paymentRepository,
    },
    options
  ) {
    super()

    this.options = options

    /** @private @const {EntityManager} */
    this.manager_ = manager
    /** @private @const {ProductService} */
    this.productService_ = productService
    /** @private @const {ProductVariantService} */
    this.productVariantService_ = productVariantService
    /** @private @const {ProductCollectionService} */
    this.collectionService_ = productCollectionService
    /** @private @const {ShippingProfileService} */
    this.shippingProfileService_ = shippingProfileService
    /** @private @const {CustomerService} */
    this.customerService_ = customerService
    /** @private @const {OrderService} */
    this.orderService_ = orderService
    /** @private @const {RegionService} */
    this.regionService_ = regionService
    /** @private @const {PaymentRepository} */
    this.paymentRepository_ = paymentRepository
  }

  withTransaction(transactionManager) {
    if (!transactionManager) {
      return this
    }

    const cloned = new ShopifyService({
      manager: transactionManager,
      orderService: this.orderService_,
      customerService: this.customerService_,
      productCollectionService: this.collectionService_,
      shippingProfileService: this.shippingProfileService_,
      productVariantRepository: this.productVariantRepository_,
      productService: this.productService_,
      regionService: this.regionService_,
      paymentRepository: this.paymentRepository_,
    })

    cloned.transactionManager_ = transactionManager

    return cloned
  }

  async importShopify() {
    return this.atomicPhase_(async (manager) => {
      await this.shippingProfileService_.createDefault()
      await this.shippingProfileService_.createGiftCardDefault()

      const {
        products,
        customCollections,
        smartCollections,
        collects,
      } = await fetchShopify(this.options)

      const normalizedCustomCollections = customCollections.map((cc) =>
        this.normalizeCollection(cc)
      )
      const normalizedSmartCollections = smartCollections.map((sc) =>
        this.normalizeCollection(sc)
      )

      await this.createCollectionsWithProducts(
        collects,
        normalizedCustomCollections,
        products
      )

      await this.createCollectionsWithProducts(
        collects,
        normalizedSmartCollections,
        products
      )

      await Promise.all(products.map(async (p) => await this.createProduct(p)))
    })
  }

  async createCollectionsWithProducts(
    collects,
    normalizedCollections,
    products
  ) {
    return this.atomicPhase_(async (manager) => {
      return Promise.all(
        normalizedCollections.map(async (nc) => {
          const collection = await this.collectionService_
            .withTransaction(manager)
            .create(nc)

          const productIds = collects.reduce((productIds, c) => {
            if (c.collection_id === collection.metadata.sh_id) {
              productIds.push(c.product_id)
            }
            return productIds
          }, [])

          const reducedProducts = products.reduce((reducedProducts, p) => {
            if (productIds.includes(p.id)) {
              reducedProducts.push(p)
              /**
               * As we only support products belonging to one collection,
               * we need to remove the product from the list of products
               * to prevent trying to add a product to several collections.
               * This is done on a first-come basis, so once a product belongs
               * to a collection, it is then removed from the list of products
               * that still needs to be imported.
               */
              removeIndex(products, p)
            }
            return reducedProducts
          }, [])

          return Promise.all(
            reducedProducts.map(async (rp) => {
              await this.createProduct(rp)
            })
          )
        })
      )
    })
  }

  async createProduct(productOrId) {
    return this.atomicPhase_(async (manager) => {
      let product
      let shippingProfile

      if (typeof productOrId === "string") {
        product = await fetchProduct(productOrId, this.options)
      } else {
        product = productOrId
      }

      const normalizedProduct = this.normalizeProduct(product)
      // Get default shipping profile
      if (normalizedProduct.is_giftcard) {
        shippingProfile = await this.shippingProfileService_.retrieveGiftCardDefault()
      } else {
        shippingProfile = await this.shippingProfileService_.retrieveDefault()
      }

      const variants = normalizedProduct.variants
      delete normalizedProduct.variants

      normalizedProduct.profile_id = shippingProfile

      const newProd = await this.productService_
        .withTransaction(manager)
        .create(normalizedProduct)

      if (variants && variants.length) {
        const optionIds = normalizedProduct.options.map(
          (o) => newProd.options.find((newO) => newO.title === o.title).id
        )

        for (const v of variants) {
          const variant = {
            ...v,
            options: v.options.map((o, index) => ({
              ...o,
              option_id: optionIds[index],
            })),
          }

          await this.productVariantService_
            .withTransaction(manager)
            .create(newProd.id, variant)
        }
      }
    })
  }

  async createCustomer(customer, shippingAddress, billingAddress) {
    return this.atomicPhase_(async (manager) => {
      const normalizedCustomer = this.normalizeCustomer(
        customer,
        shippingAddress,
        billingAddress
      )
      let normalizedBilling = normalizedCustomer.billing_address
      let normalizedShipping = normalizedCustomer.shipping_address

      const existingCustomer = await this.customerService_
        .retrieveByEmail(normalizedCustomer.email)
        .catch((_err) => undefined)

      if (existingCustomer) {
        return existingCustomer
      }

      delete normalizedCustomer.billing_address
      delete normalizedCustomer.shipping_address

      const medCustomer = await this.customerService_
        .withTransaction(manager)
        .create(normalizedCustomer)

      await this.customerService_
        .withTransaction(manager)
        .addAddress(medCustomer.id, normalizedShipping)
        .catch((err) => {
          console.log("Error on addAddress", normalizedShipping)
        })

      const result = await this.customerService_
        .withTransaction(manager)
        .update(medCustomer.id, {
          billing_address: normalizedBilling,
        })
        .catch((err) => {
          console.log("Error on update billing_address", normalizedBilling)
        })

      return result
    })
  }

  async addShippingMethod(shippingLine, orderId, taxRate) {
    const soId = "so_01FGBWR464D68CWN2XZKD6KYF5" //temp

    return this.atomicPhase_(async (manager) => {
      const order = await this.orderService_
        .withTransaction(manager)
        .addShippingMethod(
          orderId,
          soId,
          {},
          {
            price: parsePrice(shippingLine.price) * (1 - taxRate),
          }
        )

      return order
    })
  }

  async createOrder(order) {
    return this.atomicPhase_(async (manager) => {
      const { customer, shipping_address, billing_address, tax_lines } = order

      const medCustomer = await this.createCustomer(
        customer,
        shipping_address,
        billing_address
      )

      if (!medCustomer) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `An error occured while attempting to create or retrieve a customer`
        )
      }

      const region = await this.regionService_.retrieveByCountryCode(
        shipping_address.country_code.toLowerCase()
      )

      const orderTaxRate = tax_lines[0].rate || 0

      const normalizedOrder = await this.normalizeOrder(
        order,
        medCustomer.id,
        region.id,
        region.tax_rate,
        orderTaxRate
      )

      if (!normalizedOrder) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `An error occurred while normalizing the order`
        )
      }

      const medOrder = await this.orderService_
        .withTransaction(manager)
        .create(normalizedOrder)

      await Promise.all(
        order.shipping_lines.map(async (sl) =>
          this.addShippingMethod(sl, medOrder.id, orderTaxRate)
        )
      )

      await this.createPayment({
        order_id: medOrder.id,
        currency_code: medOrder.currency_code,
        total: this.getOrderTotal(order),
      })
    })
  }

  async createPayment(data) {
    return this.atomicPhase_(async (manager) => {
      const paymentRepo = manager.getCustomRepository(this.paymentRepository_)

      const created = paymentRepo.create({
        provider_id: "shopify",
        amount: data.total,
        currency_code: data.currency_code,
        data: {},
        order_id: data.order_id,
      })

      return paymentRepo.save(created)
    })
  }

  async updateProduct(product) {
    console.log("Received =>", product)

    const { handle } = product
    const toUpdate = await this.productService_
      .retrieveByHandle(handle)
      .catch((_) => undefined)

    if (!toUpdate) {
      console.log("No product found")
      return {}
    }

    console.log("Found => ", toUpdate)
    return toUpdate
  }

  async normalizeOrder(
    shopifyOrder,
    customerId,
    regionId,
    taxRate,
    shopifyTaxRate
  ) {
    return this.atomicPhase_(async (manager) => {
      return {
        status: this.normalizeOrderStatus(),
        region_id: regionId,
        email: shopifyOrder.email,
        customer_id: customerId,
        currency_code: shopifyOrder.currency.toLowerCase(),
        tax_rate: taxRate,
        tax_total: parsePrice(shopifyOrder.total_tax),
        subtotal: shopifyOrder.subtotal_price,
        shipping_address: this.normalizeAddress(shopifyOrder.shipping_address),
        billing_address: this.normalizeAddress(shopifyOrder.billing_address),
        discount_total: shopifyOrder.total_discounts,
        fulfilment_status: this.normalizeOrderFulfilmentStatus(
          shopifyOrder.fulfilment_status
        ),
        payment_status: this.normalizeOrderPaymentStatus(
          shopifyOrder.financial_status
        ),
        items: await Promise.all(
          shopifyOrder.line_items.map(async (i) => {
            return this.normalizeLineItem(i, shopifyTaxRate)
          })
        ),
        external_id: shopifyOrder.id,
      }
    })
  }

  getOrderTotal(order) {
    const shippingTotal = order.shipping_lines.reduce(
      (total, i) => parsePrice(i.price) + total,
      0
    )

    const itemTotal = order.line_items.reduce(
      (total, i) => parsePrice(i.price) + total,
      0
    )

    return shippingTotal + itemTotal
  }

  async normalizeLineItem(lineItem, taxRate) {
    return this.atomicPhase_(async (manager) => {
      const productVariant = await this.productVariantService_
        .withTransaction(manager)
        .retrieveBySKU(lineItem.sku)

      return {
        title: lineItem.title,
        is_giftcard: lineItem.gift_card,
        unit_price: parsePrice(lineItem.price) * (1 - taxRate),
        quantity: lineItem.quantity,
        fulfilled_quantity:
          lineItem.fulfillment_status === "fulfilled"
            ? lineItem.fulfillable_quantity
            : 0,
        variant_id: productVariant.id,
      }
    })
  }

  normalizeOrderStatus() {
    return "completed"
  }

  normalizeOrderFulfilmentStatus(fulfilmentStatus) {
    switch (fulfilmentStatus) {
      case null:
        return "not_fulfilled"
      case "fulfilled":
        return "fulfilled"
      case "partial":
        return "partially_fulfilled"
      case "restocked":
        return "returned"
      case "pending":
        return "not_fulfilled"
      default:
        break
    }
  }

  normalizeOrderPaymentStatus(financial_status) {
    switch (financial_status) {
      case "refunded":
        return "refunded"
      case "voided":
        return "canceled"
      case "partially_refunded":
        return "partially_refunded"
      case "paid":
        return "captured"
      case "partially_paid":
        return "not_paid"
      case "authorized":
        return "awaiting"
      case "pending":
        return "not_paid"
      default:
        break
    }
  }

  normalizeProductOption(option) {
    return {
      title: option.name,
      values: option.values.map((v) => {
        return { value: v }
      }),
    }
  }

  normalizePrices(presentmentPrices) {
    return presentmentPrices.map((p) => {
      return {
        amount: parsePrice(p.price.amount),
        currency_code: p.price.currency_code.toLowerCase(),
      }
    })
  }

  normalizeVariantOptions(option1, option2, option3) {
    let opts = []
    if (option1) {
      opts.push({
        value: option1,
      })
    }

    if (option2) {
      opts.push({
        value: option2,
      })
    }

    if (option3) {
      opts.push({
        value: option3,
      })
    }

    return opts
  }

  normalizeTag(tag) {
    return {
      value: tag,
    }
  }

  normalizeVariant(variant) {
    return {
      title: variant.title,
      prices: this.normalizePrices(variant.presentment_prices),
      sku: variant.sku || null,
      barcode: variant.barcode || null,
      upc: variant.barcode || null,
      inventory_quantity: variant.inventory_quantity,
      variant_rank: variant.position,
      allow_backorder: variant.inventory_policy === "continue",
      manage_inventory: variant.inventory_management === "shopify", //if customer previously managed inventory through Shopify then true
      weight: parseInt(variant.weight * 100),
      options: this.normalizeVariantOptions(
        variant.option1,
        variant.option2,
        variant.option3
      ),
    }
  }

  normalizeProduct(product, collectionId) {
    return {
      title: product.title,
      handle: product.handle,
      is_giftcard: product.product_type === "Gift Cards",
      options:
        product.options.map((option) => this.normalizeProductOption(option)) ||
        [],
      variants:
        product.variants.map((variant) => this.normalizeVariant(variant)) || [],
      tags: product.tags.split(",").map((tag) => this.normalizeTag(tag)) || [],
      images: product.images.map((img) => img.src) || [],
      thumbnail: product.image?.src || null,
      collection_id: collectionId || null,
      metadata: {
        sh_id: product.id,
      },
      status: "proposed", //products from Shopify should always be of status "proposed"
    }
  }

  normalizeCollection(shopifyCollection) {
    return {
      title: shopifyCollection.title,
      handle: shopifyCollection.handle,
      metadata: {
        sh_id: shopifyCollection.id,
        sh_body: shopifyCollection.body_html,
      },
    }
  }

  normalizeAddress(shopifyAddress) {
    let addr = {}
    try {
      addr = {
        first_name: shopifyAddress.first_name,
        last_name: shopifyAddress.last_name,
        phone: shopifyAddress.phone,
        company: shopifyAddress.company,
        address_1: shopifyAddress.address1,
        address_2: shopifyAddress.address2,
        city: shopifyAddress.city,
        postal_code: shopifyAddress.zip,
        country_code: shopifyAddress.country_code.toLowerCase(),
        province: shopifyAddress.province_code,
      }
    } catch (_err) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `An error occured while normalizing an address due to invalid data`
      )
    }

    return addr
  }

  normalizeCustomer(shopifyCustomer, shippingAddress, billingAddress) {
    return {
      first_name: shopifyCustomer.first_name,
      last_name: shopifyCustomer.last_name,
      email: shopifyCustomer.email,
      phone: shopifyCustomer.phone,
      shipping_address: this.normalizeAddress(shippingAddress),
      billing_address: this.normalizeAddress(billingAddress),
      metadata: {
        sh_id: shopifyCustomer.id,
      },
    }
  }
}

export default ShopifyService
