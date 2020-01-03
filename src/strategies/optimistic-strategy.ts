import { Transform, Query } from '@orbit/data';

import { RemoteStrategy, RemoteStrategyOptions } from './remote-strategy';

export interface OptimisticStrategyOptions extends RemoteStrategyOptions {
  /**
   * A handler for errors thrown as a result of performing an update.
   */
  catch?: (transform: Transform, e: Error) => void;
}

export class OptimisticStrategy extends RemoteStrategy {
  catch?: (transform: Transform, e: Error) => void;

  constructor(options: OptimisticStrategyOptions) {
    super(options);

    this.catch = options.catch;
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

  get onLine(): boolean {
    return window === undefined ? true : navigator.onLine;
  }

  protected generateTransformListener() {
    return (transform: Transform) => {
      (this.source as any).sync(transform);
    };
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

  protected generateBeforeQueryListener() {
    return (query: Query) => {
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
      const result = (this.target as any).push(transform);

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
        this.skipAndThrowError(e);
      } else if (this.catch) {
        this.catch.apply(this, [transform, e]);
      } else {
        this.skipAndThrowError(e);
      }
    };
  }
}
