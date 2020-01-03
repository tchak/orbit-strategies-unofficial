import Coordinator from '@orbit/coordinator';
import {
  Query,
  serializeRecordIdentity,
  QueryExpression,
  FindRecord,
  FindRecords,
  FindRelatedRecord,
  FindRelatedRecords
} from '@orbit/data';
import MemorySource, { MemoryCache } from '@orbit/memory';

const caches = new WeakMap<Coordinator, QueryCache>();

export class QueryCache {
  private _cache?: MemoryCache;
  private _expressions = new Map();

  constructor(cache?: MemoryCache) {
    this._cache = cache;
  }

  load(query: Query): void {
    for (let expression of query.expressions) {
      this._expressions.set(
        this.queryExpressionToCacheKey(expression),
        Date.now()
      );
    }
  }

  has(query: Query): boolean {
    for (let expression of query.expressions) {
      if (
        !this.queryExpressionIsLoaded(expression) &&
        !this.hasQueryExpressionInCache(expression)
      ) {
        return false;
      }
    }
    return true;
  }

  private queryExpressionIsLoaded(expression: QueryExpression) {
    return this._expressions.has(this.queryExpressionToCacheKey(expression));
  }

  private hasQueryExpressionInCache(expression: QueryExpression) {
    if (!this._cache) {
      return false;
    } else if (expression.op === 'findRecord') {
      const { record } = expression as FindRecord;

      return this._cache.getRecordSync(record) !== undefined;
    } else if (expression.op === 'findRecords') {
      const { records } = expression as FindRecords;

      if (records) {
        return this._cache.getRecordsSync(records).length === records.length;
      }
    } else if (expression.op === 'findRelatedRecord') {
      const { record, relationship } = expression as FindRelatedRecord;

      return (
        this._cache.getRelatedRecordSync(record, relationship) !== undefined
      );
    } else if (expression.op === 'findRelatedRecords') {
      const { record, relationship } = expression as FindRelatedRecords;

      return (
        this._cache.getRelatedRecordsSync(record, relationship) !== undefined
      );
    }

    return false;
  }

  private queryExpressionToCacheKey(expression: QueryExpression) {
    switch (expression.op) {
      case 'findRecord':
        return serializeRecordIdentity((expression as FindRecord).record);
      case 'findRelatedRecord':
        let { record, relationship } = expression as FindRelatedRecord;
        return `${serializeRecordIdentity(record)}:${relationship}`;
      default:
        return JSON.stringify(expression);
    }
  }
}

export function getQueryCache(coordinator: Coordinator) {
  let cache = caches.get(coordinator);

  if (!cache) {
    const memoryCache = findMemoryCache(coordinator);
    cache = new QueryCache(memoryCache);
    caches.set(coordinator, cache);
  }

  return cache;
}

export function dropQueryCache(coordinator: Coordinator) {
  caches.delete(coordinator);
}

function findMemoryCache(coordinator: Coordinator): MemoryCache | undefined {
  for (let source of coordinator.sources) {
    if (source instanceof MemorySource) {
      return source.cache;
    }
  }
  return;
}
