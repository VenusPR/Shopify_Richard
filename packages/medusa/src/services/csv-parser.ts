import { AwilixContainer } from "awilix"
import { difference } from "lodash"
import Papa, { ParseConfig } from "papaparse"
import { AbstractParser } from "../interfaces/abstract-parser"
import { CsvSchema } from "../interfaces/csv-parser"

const DEFAULT_PARSE_OPTIONS = {
  dynamicTyping: true,
  header: true,
}

class CsvParser<
  TSchema extends CsvSchema = CsvSchema,
  TParserResult = unknown,
  TOutputResult = unknown
> extends AbstractParser<TSchema, TParserResult, ParseConfig, TOutputResult> {
  protected readonly $$delimiter: string = ";"

  constructor(
    protected readonly container: AwilixContainer,
    schema: TSchema,
    delimiter?: string
  ) {
    super(schema)
    if (delimiter) {
      this.$$delimiter = delimiter
    }
  }

  public async parse(
    readableStream: NodeJS.ReadableStream,
    options: ParseConfig = DEFAULT_PARSE_OPTIONS
  ): Promise<TParserResult[]> {
    const csvStream = Papa.parse(Papa.NODE_STREAM_INPUT, options)

    const parsedContent: TParserResult[] = []
    readableStream.pipe(csvStream)
    for await (const chunk of csvStream) {
      parsedContent.push(chunk)
    }

    return parsedContent
  }

  async buildData(data: TParserResult[]): Promise<TOutputResult[]> {
    const validatedData = [] as TOutputResult[]
    for (let i = 0; i < data.length; i++) {
      const builtLine = await this._buildLine(data[i], i + 1)
      validatedData.push(builtLine)
    }
    return validatedData
  }

  private async _buildLine(
    line: TParserResult,
    lineNumber: number
  ): Promise<TOutputResult> {
    const outputTuple = {} as TOutputResult
    const columnMap = this._buildColumnMap(this.$$schema.columns)

    const tupleKeys = Object.keys(line)

    /**
     * map which keeps track of the columns processed
     * used to detect any missing columns which are present in the schema but not in the line
     */
    const processedColumns = {}
    for (const tupleKey of tupleKeys) {
      const column = this._resolveColumn(tupleKey, columnMap)

      /**
       * if the tupleKey does not correspond to any column defined in the schema
       */
      if (!column) {
        throw new Error(
          `Unable to treat column ${tupleKey} from the csv file. No target column found in the provided schema`
        )
      }

      /**
       * if the value corresponding to the tupleKey is empty and the column is required in the schema
       */
      if (!line[tupleKey] && column.required) {
        throw new Error(
          `No value found for target column "${column.name}" in line ${lineNumber} of the given csv file`
        )
      }

      const context = {
        line,
        lineNumber,
        column: tupleKey,
      }

      if (column.validator) {
        await column.validator.validate(line[tupleKey], context)
      }

      outputTuple[column.mapTo ?? tupleKey] = column.transformer
        ? column.transformer(line[tupleKey], context)
        : line[tupleKey]

      processedColumns[column.name] = true
    }

    /**
     * missing columns = columns defined in the schema - columns present in the line
     */
    const missingColumns = difference(
      Object.keys(columnMap),
      Object.keys(processedColumns)
    )

    if (missingColumns.length > 0) {
      throw new Error(
        `Missing column(s) ${formatMissingColumns(
          missingColumns
        )} from the given csv file`
      )
    }

    return outputTuple
  }

  private _buildColumnMap(
    columns: TSchema["columns"]
  ): Record<string, TSchema["columns"][number]> {
    return columns.reduce((map, column) => {
      if (typeof column.name === "string") {
        map[column.name] = column
      }
      return map
    }, {})
  }

  private _resolveColumn(
    tupleKey: string,
    columnMap: Record<string, TSchema["columns"][number]>
  ): TSchema["columns"][number] | undefined {
    if (columnMap[tupleKey]) {
      return columnMap[tupleKey]
    }

    const matchedColumn = this.$$schema.columns.find((column) =>
      typeof column.match === "object" && column.match instanceof RegExp
        ? column.match.test(tupleKey)
        : false
    )

    return matchedColumn
  }
}

const formatMissingColumns = (list: string[]): string =>
  list.reduce(
    (text, curr, i, array) =>
      text + (i < array.length - 1 ? `"${curr}", ` : `"${curr}"`),
    ""
  )

export default CsvParser
