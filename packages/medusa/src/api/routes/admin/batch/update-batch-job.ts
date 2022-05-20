import { IsEnum, IsObject, IsOptional, IsString } from "class-validator"
import { BatchJobService } from "../../../../services"
import { BatchJobStatus } from "../../../../types/batch-job"
import { validator } from "../../../../utils/validator"
import { MedusaError } from "medusa-core-utils"

/**
 * @oas [post] /batch/{id}
 * operationId: "AdminPostBatchJobsBatchJobReq"
 * summary: "Update a batch job"
 * description: "Updates a batch job."
 * x-authenticated: true
 * parameters:
 *   - (path) id=* {string} The id of the batch job
 * requestBody:
 *   content:
 *     application/json:
 *       schema:
 *         properties:
 *           type:
 *             type: string
 *             description:  An optional The type of the batch job.
 *           status:
 *             type: string
 *             description:  An optional status to update on the batch job.
 *           result:
 *             type: object
 *             description: An optional set of key-value pairs to hold additional information.
 *           context:
 *             type: object
 *             description: An optional set of key-value pairs to hold additional information in the context.
 * tags:
 *   - Batch Job
 * responses:
 *  "200":
 *    description: OK
 *    content:
 *      application/json:
 *        schema:
 *          properties:
 *            collection:
 *              $ref: "#/components/schemas/batch_job"
 */
export default async (req, res) => {
  let batch_job = req.batch_job

  const validated = await validator(AdminPostBatchJobsBatchJobReq, req.body)

  const batchJobService: BatchJobService = req.scope.resolve("batchJobService")
  await batchJobService.update(batch_job.id, validated)

  batch_job = await batchJobService.retrieve(batch_job.id)
  res.status(200).json({ batch_job })
}

export class AdminPostBatchJobsBatchJobReq {
  @IsString()
  @IsOptional()
  type?: string

  @IsEnum(BatchJobStatus)
  @IsOptional()
  status?: BatchJobStatus

  @IsObject()
  @IsOptional()
  result?: Record<string, unknown>

  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>
}