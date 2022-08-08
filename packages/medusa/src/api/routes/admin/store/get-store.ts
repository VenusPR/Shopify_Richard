import { FulfillmentProvider, PaymentProvider, Store } from "../../../../models"
import {
  FulfillmentProviderService,
  PaymentProviderService,
  StoreService,
} from "../../../../services"

import { FeatureFlagsResponse } from "../../../../types/feature-flags"
import { FlagRouter } from "../../../../utils/flag-router"

/**
 * @oas [get] /store
 * operationId: "GetStore"
 * summary: "Retrieve Store details."
 * description: "Retrieves the Store details"
 * x-authenticated: true
 * x-codeSamples:
 *   - lang: JavaScript
 *     label: JS Client
 *     source: |
 *       import Medusa from "@medusajs/medusa-js"
 *       const medusa = new Medusa({ baseUrl: MEDUSA_BACKEND_URL, maxRetries: 3 })
 *       // must be previously logged in or use api token
 *       medusa.admin.store.retrieve()
 *   - lang: Shell
 *     label: cURL
 *     source: |
 *       curl --location --request GET 'localhost:9000/admin/store' \
 *       --header 'Authorization: Bearer {api_token}'
 * tags:
 *   - Store
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           properties:
 *             store:
 *               $ref: "#/components/schemas/store"
 */
export default async (req, res) => {
  const storeService: StoreService = req.scope.resolve("storeService")

  const featureFlagRouter: FlagRouter = req.scope.resolve("featureFlagRouter")

  const paymentProviderService: PaymentProviderService = req.scope.resolve(
    "paymentProviderService"
  )
  const fulfillmentProviderService: FulfillmentProviderService =
    req.scope.resolve("fulfillmentProviderService")

  const relations = ["currencies", "default_currency"]
  if (featureFlagRouter.isFeatureEnabled("sales_channels")) {
    relations.push("default_sales_channel")
  }

  const data = (await storeService.retrieve({
    relations,
  })) as Store & {
    payment_providers: PaymentProvider[]
    fulfillment_providers: FulfillmentProvider[]
    feature_flags: FeatureFlagsResponse
  }

  data.feature_flags = featureFlagRouter.listFlags()

  const paymentProviders = await paymentProviderService.list()
  const fulfillmentProviders = await fulfillmentProviderService.list()

  data.payment_providers = paymentProviders
  data.fulfillment_providers = fulfillmentProviders

  res.status(200).json({ store: data })
}
