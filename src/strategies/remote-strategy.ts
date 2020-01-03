import Orbit, { Listener } from '@orbit/core';
import Coordinator, {
  ActivationOptions,
  Strategy,
  StrategyOptions
} from '@orbit/coordinator';
import {
  Source,
  Query,
  Transform,
  FindRecord,
  FindRecords,
  FindRelatedRecord,
  FindRelatedRecords,
  NetworkError,
  QueryExpression
} from '@orbit/data';

import { RetryPolicy, RetryPolicyOptions } from '../retry-policy';
import { CachePolicy, CachePolicyOptions } from '../cache-policy';

const { assert } = Orbit;

export interface RemoteStrategyOptions extends StrategyOptions {
  /**
   * The name of the local memory source.
   */
  source: string;

  /**
   * The name of the target remote source.
   */
  target: string;

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

function defaultShouldRetryQuery(query: Query, e: Error): boolean {
  return e instanceof NetworkError;
}

function defaultShouldRetryUpdate(transform: Transform, e: Error): boolean {
  return e instanceof NetworkError;
}

export class RemoteStrategy extends Strategy {
  private _listeners: (() => void)[];

  get source(): Source {
    return this._sources[0];
  }

  get target(): Source {
    return this._sources[1];
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

  constructor(options: RemoteStrategyOptions) {
    const { source, target } = options;

    assert(
      'A `source` Source must be specified for a RemoteStrategy',
      !!source
    );
    assert(
      'A `target` Source must be specified for a RemoteStrategy',
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

    const defaultName = `${source}:{query|update} -> ${target}:{pull|push}`;

    options.sources = [source, target];
    options.name = options.name || defaultName;

    super(options);

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

  generateListeners(): Listener[] {
    return [];
  }

  protected skipAndThrowError(e: Error) {
    this.source.requestQueue.skip(e);
    this.target.requestQueue.skip(e);
    throw e;
  }

  async activate(
    coordinator: Coordinator,
    options: ActivationOptions = {}
  ): Promise<void> {
    await super.activate(coordinator, options);

    this.cachePolicy.setCache((this.source as any).cache);

    this._listeners = this.generateListeners();
  }

  async deactivate(): Promise<void> {
    this.retryPolicy.reset();
    this.cachePolicy.clear();

    this._listeners.map(off => off());
    await super.deactivate();
  }

  protected shouldReload(query: Query): boolean {
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
}
