import Orbit from '@orbit/core';
import {
  Source,
  Transform,
  Query,
  QueryExpression,
  QueryBuilder,
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

export interface OptimisticStrategyOptions extends StrategyOptions {
  /**
   * The name of the source.
   */
  source: string;

  /**
   * The name of the target source.
   */
  target: string;

  /**
   * The name of the backup source.
   */
  backup: string;

  /**
   * Cache policy to use for queries.
   */
  cachePolicy?: CachePolicyOptions;

  /**
   * Retry policy to use for requests.
   */
  retryPolicy?: RetryPolicyOptions;

  shouldReloadRecord?: (
    queryExpression: FindRecord,
    options?: object
  ) => boolean;

  shouldReloadRecords?: (
    queryExpression: FindRecords,
    options?: object
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

function defaultShouldRetryQuery(query: Query, e: Error): boolean {
  return false;
}

function defaultShouldRetryUpdate(transform: Transform, e: Error): boolean {
  return e instanceof NetworkError;
}

export class OptimisticStrategy extends Strategy {
  private _listeners: (() => void)[];

  get source(): Source {
    return this._sources[0];
  }

  get target(): Source {
    return this._sources[1];
  }

  get backup(): Source {
    return this._sources[2];
  }

  cachePolicy: CachePolicy;
  retryPolicy: RetryPolicy;

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

  constructor(options: OptimisticStrategyOptions) {
    const { source, target, backup } = options;

    assert(
      'A `source` Source must be specified for a OptimisticStrategy',
      !!source
    );
    assert(
      'A `target` Source must be specified for a OptimisticStrategy',
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
    assert(
      '`backup` should be a Source name specified as a string',
      typeof backup === 'string'
    );

    let defaultName = `${source} -> ${target} -> ${backup}`;

    options.sources = [source, target, backup];
    options.name = options.name || defaultName;

    super(options);
    this._listeners = [];
    this.retryPolicy = new RetryPolicy(options.retryPolicy);
    this.cachePolicy = new CachePolicy(options.cachePolicy);

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
      this.target.on('transform', this.generateTargetTransformListener()),
      this.source.on('transform', this.generateSourceTransformListener()),
      this.source.on('beforeQuery', this.generateBeforeQueryListener()),
      this.source.on('queryFail', this.generateQueryFailListener()),
      this.source.on('beforeUpdate', this.generateBeforeUpdateListener()),
      this.source.on('updateFail', this.generateUpdateFailListener())
    ];

    await this.restoreBackup();
  }

  async deactivate(): Promise<void> {
    this.retryPolicy.reset();
    this.cachePolicy.clear();

    this._listeners.map(off => off());
    await super.deactivate();
  }

  get onLine(): boolean {
    return window === undefined ? true : navigator.onLine;
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

  protected restoreBackup() {
    return action(
      this.backup,
      'pull'
    )((q: QueryBuilder) => q.findRecords()).then(action(this.source, 'sync'));
  }

  protected filterBeforeQuery(query: Query) {
    if (this.shouldReload(query)) {
      return true;
    }

    if (this.cachePolicy.has(query)) {
      return false;
    }

    return this.onLine;
  }

  protected blockingBeforeQuery(query: Query) {
    return this.shouldReload(query) || !this.cachePolicy.has(query);
  }

  protected generateTargetTransformListener() {
    return (transform: Transform) => {
      action(this.source, 'sync')(transform);
    };
  }

  protected generateSourceTransformListener() {
    return (transform: Transform) => {
      action(this.backup, 'sync')(transform);
    };
  }

  protected generateBeforeQueryListener() {
    return (query: Query) => {
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
        this.target.requestQueue.skip(e);
      }
    };
  }

  protected generateBeforeUpdateListener() {
    return (transform: Transform) => {
      const result = action(this.target, 'push')(transform);

      if (result && result.then) {
        result.then(() => {
          this.retryPolicy.reset();
        });

        if (transform.options && transform.options.blocking) {
          return result;
        }
      }
    };
  }

  protected generateUpdateFailListener() {
    return (transform: Transform, e: Error) => {
      if (this.retryPolicy.canRetry && this.shouldRetryUpdate(transform, e)) {
        this.retryPolicy.retry(() => {
          this.target.requestQueue.retry();
        });
      } else if (
        this.retryPolicy.enabled &&
        !this.onLine &&
        this.shouldRetryUpdate(transform, e)
      ) {
        this.retryPolicy.retry(() => {
          this.target.requestQueue.retry();
        }, this.retryPolicy.maxDelay);
      } else if (transform.options && transform.options.blocking) {
        this.source.requestQueue.skip(e);
        this.target.requestQueue.skip(e);
        throw e;
      } else {
        this.target.requestQueue.skip(e);
      }
    };
  }
}

function action(target: Source, action: string) {
  return (...args: any[]) => (target as any)[action](...args);
}
