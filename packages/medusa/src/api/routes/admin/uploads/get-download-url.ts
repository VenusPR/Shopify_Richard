import { AbstractFileService } from "../../../../interfaces"
import { IsString } from "class-validator"

/**
 * [post] /uploads/download-url
 * operationId: "PostUploadsDownloadUrl"
 * summary: "Creates a presigned download url for a file"
 * description: "Creates a presigned download url for a file"
 * x-authenticated: true
 * requestBody:
 *   content:
 *     application/json:
 *       schema:
 *         required:
 *           - file_key
 *         properties:
 *           file_key:
 *             description: "key of the file to obtain the download link for"
 *             type: string
 * x-codeSamples:
 *   - lang: JavaScript
 *     label: JS Client
 *     source: |
 *       import Medusa from "@medusajs/medusa-js"
 *       const medusa = new Medusa({ baseUrl: MEDUSA_BACKEND_URL, maxRetries: 3 })
 *       // must be previously logged in or use api token
 *       medusa.admin.uploads.getPresignedDownloadUrl({
 *         file_key
 *       })
 *   - lang: Shell
 *     label: cURL
 *     source: |
 *       curl --location --request POST 'localhost:9000/admin/uploads/download-url' \
 *       --header 'Authorization: Bearer {api_token}' \
 *       --header 'Content-Type: application/json' \
 *       --data-raw '{
 *           "file_key": "{file_key}"
 *       }'
 * tags:
 *   - Upload
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           properties:
 *             download_url:
 *               type: string
 *               description: The Download URL of the file
 */
export default async (req, res) => {
  const fileService: AbstractFileService<any> = req.scope.resolve("fileService")

  const url = await fileService.getPresignedDownloadUrl({
    fileKey: (req.validatedBody as AdminPostUploadsDownloadUrlReq).file_key,
  })

  res.status(200).send({ download_url: url })
}

export class AdminPostUploadsDownloadUrlReq {
  @IsString()
  file_key: string
}
