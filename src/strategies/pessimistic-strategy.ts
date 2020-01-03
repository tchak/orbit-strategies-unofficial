import Orbit from '@orbit/core';
import {
  Source,
  Transform,
  Query,
  QueryExpression,
  NetworkError,
  FindRecords,
  FindRecord,
  FindRelatedRecord,
  FindRelatedRecords
} from '@orbit/data';
import Coordinator, {
  ActivationOptions,
  Strategy,
  StrategyOptions
} from '@orbit/coordinator';

import { RetryPolicy, RetryPolicyOptions } from '../retry-policy';
import { CachePolicy, CachePolicyOptions } from '../cache-policy';

const { assert } = Orbit;

export interface PessimisticStrategyOptions extends StrategyOptions {
  /**
   * The name of the source.
   */
  source: string;

  /**
   * The name of the target source.
   */
  target: string;

  /**
   * Should results returned from calling `action` on the `target` source be
   * passed as hint data back to the `source`? Default is `true`.
   */
  passHints?: boolean;

  /**
   * Cache policy to use for queries.
   */
  cachePolicy?: CachePolicyOptions;

  /**
   * Retry policy to use for requests.
   */
  retryPolicy?: RetryPolicyOptions;

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

  shouldReloadRecord?: (
    queryExpression: FindRecord,
    options?: object
  ) => boolean;

  shouldReloadRecords?: (
    queryExpression: FindRecords,
    options: object
  ) => boolean;

  shouldReloadRelatedRecord?: (
    queryExpression: FindRelatedRecord,
    options?: object
  ) => boolean;

  shouldReloadRelatedRecords?: (
    queryExpression: FindRelatedRecords,
    options?: object
  ) => boolean;

  shouldRetryQuery?: (query: Query, e: Error) => boolean;
  shouldRetryUpdate?: (transform: Transform, e: Error) => boolean;
}

function defaultShouldReload(queryExpression: QueryExpression): boolean {
  return false;
}

function defaultShouldBackgroundReload(
  queryExpression: QueryExpression
): boolean {
  return true;
}

function defaultShouldRetryQuery(query: Query, e: Error): boolean {
  return e instanceof NetworkError;
}

function defaultShouldRetryUpdate(transform: Transform, e: Error): boolean {
  return e instanceof NetworkError;
}

export class PessimisticStrategy extends Strategy {
  private _listeners: (() => void)[];

  get source(): Source {
    return this._sources[0];
  }

  get target(): Source {
    return this._sources[1];
  }

  passHints: boolean;
  cachePolicy: CachePolicy;
  retryPolicy: RetryPolicy;

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

  shouldReloadRecord: (
    queryExpression: FindRecord,
    options?: object
  ) => boolean;

  shouldReloadRecords: (
    queryExpression: FindRecords,
    options?: object
  ) => boolean;

  shouldReloadRelatedRecord: (
    queryExpression: FindRelatedRecord,
    options?: object
  ) => boolean;

  shouldReloadRelatedRecords: (
    queryExpression: FindRelatedRecords,
    options?: object
  ) => boolean;

  shouldRetryQuery: (query: Query, e: Error) => boolean;
  shouldRetryUpdate: (transform: Transform, e: Error) => boolean;

  constructor(options: PessimisticStrategyOptions) {
    const { source, target } = options;

    assert(
      'A `source` Source must be specified for a PessimisticStrategy',
      !!source
    );
    assert(
      'A `target` Source must be specified for a PessimisticStrategy',
      !!target
    );
    assert(
      '`source` should be a Source name specified as a string',
      typeof source === 'string'
    );
    assert(
      '`target` should be a Source name specified as a string',
      typeof target === 'string'
    );

    let defaultName = `${source} -> ${target}`;

    options.sources = [source, target];
    options.name = options.name || defaultName;

    super(options);
    this._listeners = [];

    this.retryPolicy = new RetryPolicy(options.retryPolicy);
    this.cachePolicy = new CachePolicy(options.cachePolicy);

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

    this.shouldReloadRecord = options.shouldReloadRecord || defaultShouldReload;
    this.shouldReloadRecords =
      options.shouldReloadRecords || defaultShouldReload;
    this.shouldReloadRelatedRecord =
      options.shouldReloadRelatedRecord || defaultShouldReload;
    this.shouldReloadRelatedRecords =
      options.shouldReloadRelatedRecords || defaultShouldReload;

    this.shouldRetryQuery = options.shouldRetryQuery || defaultShouldRetryQuery;
    this.shouldRetryUpdate =
      options.shouldRetryUpdate || defaultShouldRetryUpdate;
  }

  async activate(
    coordinator: Coordinator,
    options: ActivationOptions = {}
  ): Promise<void> {
    await super.activate(coordinator, options);

    this.cachePolicy.setCache((this.source as any).cache);

    this._listeners = [
      this.target.on('transform', this.generateTransformListener()),
      this.source.on('beforeQuery', this.generateBeforeQueryListener()),
      this.source.on('queryFail', this.generateQueryFailListener()),
      this.source.on('beforeUpdate', this.generateBeforeUpdateListener()),
      this.source.on('updateFail', this.generateUpdateFailListener())
    ];
  }

  async deactivate(): Promise<void> {
    this.retryPolicy.reset();
    this.cachePolicy.clear();

    this._listeners.map(off => off());
    await super.deactivate();
  }

  shouldBackgroundReload(query: Query): boolean {
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

  shouldReload(query: Query): boolean {
    if (query.options && query.options.reload) {
      return true;
    }

    for (let expression of query.expressions) {
      switch (expression.op) {
        case 'findRecord':
          if (
            this.shouldReloadRecord(expression as FindRecord, query.options)
          ) {
            return true;
          }
          break;
        case 'findRecords':
          if (
            this.shouldReloadRecords(expression as FindRecords, query.options)
          ) {
            return true;
          }
          break;
        case 'findRelatedRecord':
          if (
            this.shouldReloadRelatedRecord(
              expression as FindRelatedRecord,
              query.options
            )
          ) {
            return true;
          }
          break;
        case 'findRelatedRecords':
          if (
            this.shouldReloadRelatedRecords(
              expression as FindRelatedRecords,
              query.options
            )
          ) {
            return true;
          }
          break;
      }
    }
    return false;
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

  protected generateTransformListener() {
    return (transform: Transform) => action(this.source, 'sync')(transform);
  }

  protected generateBeforeQueryListener() {
    return (query: Query, hints: any) => {
      if (!this.filterBeforeQuery(query)) {
        return;
      }

      const result = action(this.target, 'pull')(query);

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
        this.source.requestQueue.skip(e);
        this.target.requestQueue.skip(e);
        throw e;
      }
    };
  }

  protected generateBeforeUpdateListener() {
    return (transform: Transform, hints: any) => {
      const result = action(this.target, 'push')(transform);

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
        this.source.requestQueue.skip(e);
        this.target.requestQueue.skip(e);
        throw e;
      }
    };
  }

  protected async applyHint(hints: any, result: Promise<any>): Promise<void> {
    return (hints.data = await result);
  }
}

function action(target: Source, action: string) {
  return (...args: any[]) => (target as any)[action](...args);
}
