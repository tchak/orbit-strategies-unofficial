import {
  Transform,
  Query,
  QueryExpression,
  FindRecords,
  FindRecord,
  FindRelatedRecord,
  FindRelatedRecords
} from '@orbit/data';

import { RemoteStrategy, RemoteStrategyOptions } from './remote-strategy';

export interface PessimisticStrategyOptions extends RemoteStrategyOptions {
  /**
   * Should results returned from calling `action` on the `target` source be
   * passed as hint data back to the `source`? Default is `true`.
   */
  passHints?: boolean;

  shouldBackgroundReloadRecord?: (
    queryExpression: FindRecord,
    options?: object
  ) => boolean;

  shouldBackgroundReloadRecords?: (
    queryExpression: FindRecords,
    options?: object
  ) => boolean;

  shouldBackgroundReloadRelatedRecord?: (
    queryExpression: FindRelatedRecord,
    options?: object
  ) => boolean;

  shouldBackgroundReloadRelatedRecords?: (
    queryExpression: FindRelatedRecords,
    options?: object
  ) => boolean;
}

function defaultShouldBackgroundReload(
  queryExpression: QueryExpression
): boolean {
  return true;
}

export class PessimisticStrategy extends RemoteStrategy {
  passHints: boolean;

  shouldBackgroundReloadRecord: (
    queryExpression: FindRecord,
    options?: object
  ) => boolean;

  shouldBackgroundReloadRecords: (
    queryExpression: FindRecords,
    options?: object
  ) => boolean;

  shouldBackgroundReloadRelatedRecord: (
    queryExpression: FindRelatedRecord,
    options?: object
  ) => boolean;

  shouldBackgroundReloadRelatedRecords: (
    queryExpression: FindRelatedRecords,
    options?: object
  ) => boolean;

  constructor(options: PessimisticStrategyOptions) {
    super(options);

    this.passHints = options.passHints !== false;

    this.shouldBackgroundReloadRecord =
      options.shouldBackgroundReloadRecord || defaultShouldBackgroundReload;
    this.shouldBackgroundReloadRecords =
      options.shouldBackgroundReloadRecords || defaultShouldBackgroundReload;
    this.shouldBackgroundReloadRelatedRecord =
      options.shouldBackgroundReloadRelatedRecord ||
      defaultShouldBackgroundReload;
    this.shouldBackgroundReloadRelatedRecords =
      options.shouldBackgroundReloadRelatedRecords ||
      defaultShouldBackgroundReload;
  }

  generateListeners() {
    return [
      this.target.on('transform', this.generateTransformListener()),
      this.source.on('beforeQuery', this.generateBeforeQueryListener()),
      this.source.on('queryFail', this.generateQueryFailListener()),
      this.source.on('beforeUpdate', this.generateBeforeUpdateListener()),
      this.source.on('updateFail', this.generateUpdateFailListener())
    ];
  }

  protected shouldBackgroundReload(query: Query): boolean {
    if (query.options && query.options.backgroundReload) {
      return true;
    }

    for (let expression of query.expressions) {
      switch (expression.op) {
        case 'findRecord':
          if (
            !this.shouldBackgroundReloadRecord(
              expression as FindRecord,
              query.options
            )
          ) {
            return false;
          }
          break;
        case 'findRecords':
          if (
            !this.shouldBackgroundReloadRecords(
              expression as FindRecords,
              query.options
            )
          ) {
            return false;
          }
          break;
        case 'findRelatedRecord':
          if (
            !this.shouldBackgroundReloadRelatedRecord(
              expression as FindRelatedRecord,
              query.options
            )
          ) {
            return false;
          }
          break;
        case 'findRelatedRecords':
          if (
            !this.shouldBackgroundReloadRelatedRecords(
              expression as FindRelatedRecords,
              query.options
            )
          ) {
            return false;
          }
          break;
      }
    }
    return true;
  }

  protected generateTransformListener() {
    return (transform: Transform) => (this.source as any).sync(transform);
  }

  protected filterBeforeQuery(query: Query) {
    if (this.shouldReload(query) || this.shouldBackgroundReload(query)) {
      return true;
    }

    if (!this.cachePolicy.has(query)) {
      return true;
    }

    return false;
  }

  protected blockingBeforeQuery(query: Query) {
    if (this.cachePolicy.has(query) && this.shouldBackgroundReload(query)) {
      return false;
    }

    return true;
  }

  protected generateBeforeQueryListener() {
    return (query: Query, hints: any) => {
      if (!this.filterBeforeQuery(query)) {
        return;
      }

      const result = (this.target as any).pull(query);

      if (result && result.then) {
        result.then(() => {
          this.retryPolicy.reset();
          this.cachePolicy.load(query);
        });

        if (this.blockingBeforeQuery(query)) {
          if (this.passHints && typeof hints === 'object') {
            return this.applyHint(hints, result);
          }
          return result;
        }
      }
    };
  }

  protected generateQueryFailListener() {
    return (query: Query, e: Error) => {
      if (this.retryPolicy.canRetry && this.shouldRetryQuery(query, e)) {
        this.retryPolicy.retry(() => {
          this.target.requestQueue.retry();
        });
      } else {
        this.skipAndThrowError(e);
      }
    };
  }

  protected generateBeforeUpdateListener() {
    return (transform: Transform, hints: any) => {
      const result = (this.target as any).push(transform);

      if (result && result.then) {
        result.then(() => {
          this.retryPolicy.reset();
        });

        if (this.passHints && typeof hints === 'object') {
          return this.applyHint(hints, result);
        }
      }

      return result;
    };
  }

  protected generateUpdateFailListener() {
    return (transform: Transform, e: Error) => {
      if (this.retryPolicy.canRetry && this.shouldRetryUpdate(transform, e)) {
        this.retryPolicy.retry(() => {
          this.target.requestQueue.retry();
        });
      } else {
        this.skipAndThrowError(e);
      }
    };
  }

  protected async applyHint(hints: any, result: Promise<any>): Promise<void> {
    return (hints.data = await result);
  }
}
