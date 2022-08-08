import { IsBoolean, IsOptional, IsString } from "class-validator"
import { Request, Response } from "express"

import { EntityManager } from "typeorm"
import { SalesChannelService } from "../../../../services"

/**
 * @oas [post] /sales-channels/{id}
 * operationId: "PostSalesChannelsSalesChannel"
 * summary: "Update a Sales Channel"
 * description: "Updates a Sales Channel."
 * x-authenticated: true
 * parameters:
 *   - (path) id=* {string} The ID of the Sales Channel.
 * requestBody:
 *   content:
 *     application/json:
 *       schema:
 *         properties:
 *           name:
 *             type: string
 *             description: Name of the sales channel.
 *           description:
 *             type: string
 *             description:  Sales Channel description.
 *           is_disabled:
 *             type: boolean
 *             description:  Indication of if the sales channel is active.
 * x-codeSamples:
 *   - lang: JavaScript
 *     label: JS Client
 *     source: |
 *       import Medusa from "@medusajs/medusa-js"
 *       const medusa = new Medusa({ baseUrl: MEDUSA_BACKEND_URL, maxRetries: 3 })
 *       // must be previously logged in
 *       medusa.admin.salesChannels.update('', {
 *         name: 'App'
 *       })
 *   - lang: Shell
 *     label: cURL
 *     source: |
 *       curl --location --request POST 'localhost:9000/admin/sales-channels/{id}' \
 *       --header 'Authorization: Bearer {api_token}' \
 *       --header 'Content-Type: application/json' \
 *       --data-raw '{
 *           "name": "App"
 *       }'
 * tags:
 *   - Sales Channel
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           properties:
 *             sales_channel:
 *               $ref: "#/components/schemas/sales_channel"
 */
export default async (req: Request, res: Response) => {
  const { id } = req.params
  const { validatedBody } = req as {
    validatedBody: AdminPostSalesChannelsSalesChannelReq
  }

  const salesChannelService: SalesChannelService = req.scope.resolve(
    "salesChannelService"
  )
  const manager: EntityManager = req.scope.resolve("manager")
  const sales_channel = await manager.transaction(
    async (transactionManager) => {
      return await salesChannelService
        .withTransaction(transactionManager)
        .update(id, validatedBody)
    }
  )

  res.status(200).json({ sales_channel })
}

export class AdminPostSalesChannelsSalesChannelReq {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  description?: string

  @IsBoolean()
  @IsOptional()
  is_disabled?: boolean
}
