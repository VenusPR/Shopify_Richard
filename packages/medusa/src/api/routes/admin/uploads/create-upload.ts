import fs from "fs"

/**
 * @oas [post] /uploads
 * operationId: "PostUploads"
 * summary: "Uploads a file"
 * description: "Uploads a file to the specific fileservice that is installed in Medusa."
 * x-authenticated: true
 * requestBody:
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         properties:
 *           files:
 *             type: string
 *             format: binary
 * x-codeSamples:
 *   - lang: JavaScript
 *     label: JS Client
 *     source: |
 *       import Medusa from "@medusajs/medusa-js"
 *       const medusa = new Medusa({ baseUrl: MEDUSA_BACKEND_URL, maxRetries: 3 })
 *       // must be previously logged in or use api token
 *       medusa.admin.uploads.create(file)
 *       .then(({ uploads }) => {
 *         console.log(uploads.length);
 *       });
 *   - lang: Shell
 *     label: cURL
 *     source: |
 *       curl --location --request POST 'https://medusa-url.com/admin/uploads' \
 *       --header 'Authorization: Bearer {api_token}' \
 *       --header 'Content-Type: image/jpeg' \
 *       --data-binary '{file_path}'
 * security:
 *   - api_token: []
 *   - cookie_auth: []
 * tags:
 *   - Upload
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           properties:
 *             uploads:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   url:
 *                     type: string
 *                     description: The URL of the uploaded file.
 *                     format: uri
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
export default async (req, res) => {
  try {
    const fileService = req.scope.resolve("fileService")

    const result = await Promise.all(
      req.files.map(async (f) => {
        return fileService.upload(f).then((result) => {
          fs.unlinkSync(f.path)
          return result
        })
      })
    )

    res.status(200).json({ uploads: result })
  } catch (err) {
    console.log(err)
    throw err
  }
}

export class IAdminPostUploadsFileReq {
  originalName: string
  path: string
}
