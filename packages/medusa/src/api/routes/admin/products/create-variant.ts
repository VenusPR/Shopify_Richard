import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator"
import { Type } from "class-transformer"
import {
  ProductService,
  ProductVariantService,
  ProductVariantInventoryService,
} from "../../../../services"
import { defaultAdminProductFields, defaultAdminProductRelations } from "."

import { IInventoryService } from "../../../../interfaces"
import {
  CreateProductVariantInput,
  ProductVariantPricesCreateReq,
} from "../../../../types/product-variant"
import { validator } from "../../../../utils/validator"

import {
  TransactionHandlerType,
  TransactionOrchestrator,
  TransactionPayload,
  TransactionState,
  TransactionStepsDefinition,
} from "../../../../utils/transaction"

import { ulid } from "ulid"
import { MedusaError } from "medusa-core-utils"

/**
 * @oas [post] /products/{id}/variants
 * operationId: "PostProductsProductVariants"
 * summary: "Create a Product Variant"
 * description: "Creates a Product Variant. Each Product Variant must have a unique combination of Product Option Values."
 * x-authenticated: true
 * parameters:
 *   - (path) id=* {string} The ID of the Product.
 * requestBody:
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required:
 *           - title
 *           - prices
 *           - options
 *         properties:
 *           title:
 *             description: The title to identify the Product Variant by.
 *             type: string
 *           sku:
 *             description: The unique SKU for the Product Variant.
 *             type: string
 *           ean:
 *             description: The EAN number of the item.
 *             type: string
 *           upc:
 *             description: The UPC number of the item.
 *             type: string
 *           barcode:
 *             description: A generic GTIN field for the Product Variant.
 *             type: string
 *           hs_code:
 *             description: The Harmonized System code for the Product Variant.
 *             type: string
 *           inventory_quantity:
 *             description: The amount of stock kept for the Product Variant.
 *             type: integer
 *             default: 0
 *           allow_backorder:
 *             description: Whether the Product Variant can be purchased when out of stock.
 *             type: boolean
 *           manage_inventory:
 *             description: Whether Medusa should keep track of the inventory for this Product Variant.
 *             type: boolean
 *           weight:
 *             description: The wieght of the Product Variant.
 *             type: number
 *           length:
 *             description: The length of the Product Variant.
 *             type: number
 *           height:
 *             description: The height of the Product Variant.
 *             type: number
 *           width:
 *             description: The width of the Product Variant.
 *             type: number
 *           origin_country:
 *             description: The country of origin of the Product Variant.
 *             type: string
 *           mid_code:
 *             description: The Manufacturer Identification code for the Product Variant.
 *             type: string
 *           material:
 *             description: The material composition of the Product Variant.
 *             type: string
 *           metadata:
 *             description: An optional set of key-value pairs with additional information.
 *             type: object
 *           prices:
 *             type: array
 *             items:
 *               required:
 *                 - amount
 *               properties:
 *                 id:
 *                   description: The ID of the price.
 *                   type: string
 *                 region_id:
 *                   description: The ID of the Region for which the price is used. Only required if currency_code is not provided.
 *                   type: string
 *                 currency_code:
 *                   description: The 3 character ISO currency code for which the price will be used. Only required if region_id is not provided.
 *                   type: string
 *                   externalDocs:
 *                     url: https://en.wikipedia.org/wiki/ISO_4217#Active_codes
 *                     description: See a list of codes.
 *                 amount:
 *                   description: The amount to charge for the Product Variant.
 *                   type: integer
 *                 min_quantity:
 *                  description: The minimum quantity for which the price will be used.
 *                  type: integer
 *                 max_quantity:
 *                   description: The maximum quantity for which the price will be used.
 *                   type: integer
 *           options:
 *             type: array
 *             items:
 *               required:
 *                 - option_id
 *                 - value
 *               properties:
 *                 option_id:
 *                   description: The ID of the Product Option to set the value for.
 *                   type: string
 *                 value:
 *                   description: The value to give for the Product Option.
 *                   type: string
 * x-codeSamples:
 *   - lang: JavaScript
 *     label: JS Client
 *     source: |
 *       import Medusa from "@medusajs/medusa-js"
 *       const medusa = new Medusa({ baseUrl: MEDUSA_BACKEND_URL, maxRetries: 3 })
 *       // must be previously logged in or use api token
 *       medusa.admin.products.createVariant(product_id, {
 *         title: 'Color',
 *         prices: [
 *           {
 *             amount: 1000,
 *             currency_code: "eur"
 *           }
 *         ],
 *         options: [
 *           {
 *             option_id,
 *             value: 'S'
 *           }
 *         ],
 *         inventory_quantity: 100
 *       })
 *       .then(({ product }) => {
 *         console.log(product.id);
 *       });
 *   - lang: Shell
 *     label: cURL
 *     source: |
 *       curl --location --request POST 'https://medusa-url.com/admin/products/{id}/variants' \
 *       --header 'Authorization: Bearer {api_token}' \
 *       --header 'Content-Type: application/json' \
 *       --data-raw '{
 *           "title": "Color",
 *           "prices": [
 *             {
 *               "amount": 1000,
 *               "currency_code": "eur"
 *             }
 *           ],
 *           "options": [
 *             {
 *               "option_id": "asdasf",
 *               "value": "S"
 *             }
 *           ]
 *       }'
 * security:
 *   - api_token: []
 *   - cookie_auth: []
 * tags:
 *   - Product
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             product:
 *               $ref: "#/components/schemas/Product"
 *   "400":
 *     $ref: "#/components/responses/400_error"
 *   "401":
 *     $ref: "#/components/responses/unauthorized"
 *   "404":
 *     $ref: "#/components/responses/not_found_error"
 *   "409":
 *     $ref: "#/components/responses/invalid_state_error"
 *   "422":
 *     $ref: "#/components/responses/invalid_request_error"
 *   "500":
 *     $ref: "#/components/responses/500_error"
 */

enum actions {
  createVariant = "createVariant",
  createInventoryItem = "createInventoryItem",
  attachInventoryItem = "attachInventoryItem",
}

const flow: TransactionStepsDefinition = {
  next: {
    action: actions.createVariant,
    forwardResponse: true,
    next: {
      action: actions.createInventoryItem,
      forwardResponse: true,
      next: {
        action: actions.attachInventoryItem,
        noCompensation: true,
      },
    },
  },
}

const createVariantStrategy = new TransactionOrchestrator(
  "create-variant",
  flow
)

export default async (req, res) => {
  const { id } = req.params

  const validated = await validator(
    AdminPostProductsProductVariantsReq,
    req.body
  )

  const inventoryService: IInventoryService =
    req.scope.resolve("inventoryService")
  const productVariantInventoryService: ProductVariantInventoryService =
    req.scope.resolve("productVariantInventoryService")
  const productVariantService: ProductVariantService = req.scope.resolve(
    "productVariantService"
  )
  const productService: ProductService = req.scope.resolve("productService")

  const createdId: Record<string, string | null> = {
    variant: null,
    inventoryItem: null,
  }

  async function createVariant() {
    const variant = await productVariantService.create(
      id,
      validated as CreateProductVariantInput
    )

    createdId.variant = variant.id

    return { variant }
  }

  async function removeVariant() {
    if (createdId.variant) {
      await productVariantService.delete(createdId.variant)
    }
  }

  async function createInventoryItem(variant) {
    if (!validated.manage_inventory) {
      return
    }

    const inventoryItem = await inventoryService.createInventoryItem({
      sku: validated.sku,
      origin_country: validated.origin_country,
      hs_code: validated.hs_code,
      mid_code: validated.mid_code,
      material: validated.material,
      weight: validated.weight,
      length: validated.length,
      height: validated.height,
      width: validated.width,
    })

    createdId.inventoryItem = inventoryItem.id

    return { variant, inventoryItem }
  }

  async function removeInventoryItem() {
    if (createdId.inventoryItem) {
      await inventoryService.deleteInventoryItem(createdId.inventoryItem)
    }
  }

  async function attachInventoryItem(variant, inventoryItem) {
    if (!validated.manage_inventory) {
      return
    }

    await productVariantInventoryService.attachInventoryItem(
      variant.id,
      inventoryItem.id,
      1
    )
  }

  async function transactionHandler(
    actionId: string,
    type: TransactionHandlerType,
    payload: TransactionPayload
  ) {
    const command = {
      [actions.createVariant]: {
        [TransactionHandlerType.INVOKE]: async () => {
          return await createVariant()
        },
        [TransactionHandlerType.COMPENSATE]: async () => {
          await removeVariant()
        },
      },
      [actions.createInventoryItem]: {
        [TransactionHandlerType.INVOKE]: async (data) => {
          const { variant } = data._response
          return await createInventoryItem(variant)
        },
        [TransactionHandlerType.COMPENSATE]: async () => {
          await removeInventoryItem()
        },
      },
      [actions.attachInventoryItem]: {
        [TransactionHandlerType.INVOKE]: async (data) => {
          const { variant, inventoryItem } = data._response
          return await attachInventoryItem(variant, inventoryItem)
        },
      },
    }
    return command[actionId][type](payload.data)
  }

  const transaction = await createVariantStrategy.beginTransaction(
    ulid(),
    transactionHandler,
    validated
  )
  await createVariantStrategy.resume(transaction)

  if (transaction.getState() !== TransactionState.DONE) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      transaction.errors.map((err) => err.error?.message).join("\n")
    )
  }

  const product = await productService.retrieve(id, {
    select: defaultAdminProductFields,
    relations: defaultAdminProductRelations,
  })

  res.json({ product })
}

class ProductVariantOptionReq {
  @IsString()
  value: string

  @IsString()
  option_id: string
}

export class AdminPostProductsProductVariantsReq {
  @IsString()
  title: string

  @IsString()
  @IsOptional()
  sku?: string

  @IsString()
  @IsOptional()
  ean?: string

  @IsString()
  @IsOptional()
  upc?: string

  @IsString()
  @IsOptional()
  barcode?: string

  @IsString()
  @IsOptional()
  hs_code?: string

  @IsNumber()
  @IsOptional()
  inventory_quantity?: number = 0

  @IsBoolean()
  @IsOptional()
  allow_backorder?: boolean

  @IsBoolean()
  @IsOptional()
  manage_inventory?: boolean

  @IsNumber()
  @IsOptional()
  weight?: number

  @IsNumber()
  @IsOptional()
  length?: number

  @IsNumber()
  @IsOptional()
  height?: number

  @IsNumber()
  @IsOptional()
  width?: number

  @IsString()
  @IsOptional()
  origin_country?: string

  @IsString()
  @IsOptional()
  mid_code?: string

  @IsString()
  @IsOptional()
  material?: string

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantPricesCreateReq)
  prices: ProductVariantPricesCreateReq[]

  @IsOptional()
  @Type(() => ProductVariantOptionReq)
  @ValidateNested({ each: true })
  @IsArray()
  options?: ProductVariantOptionReq[] = []
}
