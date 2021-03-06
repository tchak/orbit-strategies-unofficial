import {
  Query,
  serializeRecordIdentity,
  QueryExpression,
  FindRecord,
  FindRecords,
  FindRelatedRecord,
  FindRelatedRecords
} from '@orbit/data';
import { SyncRecordCache } from '@orbit/record-cache';

export interface CachePolicyOptions {
  enabled?: boolean;
  expireIn?: number;
}

export class CachePolicy {
  enabled = true;
  expireIn?: number;

  private _cache?: SyncRecordCache;
  private _loadedExpressions = new Map<string, number>();

  constructor(options?: CachePolicyOptions) {
    if (options) {
      this.enabled = options.enabled !== false;
      this.expireIn = options.expireIn;
    }
  }

  load(query: Query): void {
    if (this.enabled) {
      for (let expression of query.expressions) {
        this._loadedExpressions.set(
          this.queryExpressionToCacheKey(expression),
          Date.now()
        );
      }
    }
  }

  has(query: Query): boolean {
    if (!this.enabled) {
      return false;
    }

    for (let expression of query.expressions) {
      if (!this.queryExpressionIsLoaded(expression)) {
        return false;
      }
    }

    return true;
  }

  clear() {
    this._loadedExpressions.clear();
  }

  setCache(cache: SyncRecordCache) {
    this._cache = cache;
  }

  private queryExpressionIsLoaded(expression: QueryExpression) {
    const cacheKey = this.queryExpressionToCacheKey(expression);
    const loadedAt = this._loadedExpressions.get(cacheKey);

    if (loadedAt) {
      const age = Date.now() - loadedAt;
      if (this.expireIn && age > this.expireIn) {
        this._loadedExpressions.delete(cacheKey);
        return false;
      }
      return true;
    }

    return this.hasQueryExpressionInCache(expression);
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
