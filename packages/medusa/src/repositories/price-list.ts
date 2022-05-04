import { EntityRepository, FindOperator, Repository } from "typeorm"
import { PriceList } from "../models/price-list"
import { FindConfig } from "../types/common"

@EntityRepository(PriceList)
export class PriceListRepository extends Repository<PriceList> {
  async listAndCount(
    query: FindConfig<PriceList> & {
      where: Partial<{ -readonly [key in keyof PriceList]: PriceList[key] }>
      withDeleted?: boolean
    },
    groups?: FindOperator<PriceList>
  ): Promise<[PriceList[], number]> {
    const qb = this.createQueryBuilder("price_list")
      .where(query.where)
      .skip(query.skip)
      .take(query.take)

    if (groups) {
      qb.leftJoinAndSelect("price_list.customer_groups", "group").andWhere(
        "group.id IN (:...ids)",
        { ids: groups.value }
      )
    }

    if (query.relations?.length) {
      query.relations.forEach((rel) => {
        qb.leftJoinAndSelect(`price_list.${rel}`, rel)
      })
    }

    return await qb.getManyAndCount()
  }
}
