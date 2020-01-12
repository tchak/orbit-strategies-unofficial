import { Transform, Query, NetworkError } from '@orbit/data';

import { RemoteStrategy, RemoteStrategyOptions } from './remote-strategy';

export interface OptimisticStrategyOptions extends RemoteStrategyOptions {
  /**
   * A handler for errors thrown as a result of performing an update.
   */
  catch?: (transform: Transform, e: Error) => void;
}

export function onLine(): boolean {
  return window === undefined ? true : navigator.onLine;
}

export class OptimisticStrategy extends RemoteStrategy {
  catch?: (transform: Transform, e: Error) => void;

  constructor(options: OptimisticStrategyOptions) {
    options.prefix = 'optimistic';
    super(options);

    this.catch = options.catch;
    this._onLine = onLine();
  }

  generateListeners() {
    return [
      this.generateOnLineListener(),
      this.target.on('transform', this.generateTransformListener()),
      this.target.on('pull', this.generateQueryListener()),
      this.target.on('pullFail', this.generateQueryFailListener()),
      this.target.on('push', this.generateUpdateListener()),
      this.target.on('pushFail', this.generateUpdateFailListener()),
      this.source.on('beforeQuery', this.generateBeforeQueryListener()),
      this.source.on('queryFail', this.generateQueryFailListener()),
      this.source.on('beforeUpdate', this.generateBeforeUpdateListener()),
      this.source.on('updateFail', this.generateUpdateFailListener())
    ];
  }

  private _onLine: boolean;
  get isOnLine(): boolean {
    return this._onLine;
  }

  onLine() {
    this._onLine = onLine();
    this.retryPolicy.reset();
  }

  offLine() {
    this._onLine = false;
  }

  protected generateOnLineListener(): () => void {
    if (window === undefined) {
      return () => {};
    }

    const onLineCallback = () => {
      this.onLine();

      if (this.isOnLine && this.retryPolicy.canRetry) {
        this.retry();
      }
    };
    const offLineCallback = () => {
      this.offLine();
    };

    window.addEventListener('online', onLineCallback);
    window.addEventListener('offline', offLineCallback);

    return () => {
      window.removeEventListener('online', onLineCallback);
      window.removeEventListener('offline', offLineCallback);
    };
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

    return this.isOnLine;
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

      if (result && result.then && this.blockingBeforeQuery(query)) {
        return result.catch((e: Error) => {
          this.queryFailHandler(query, e);
        });
      }
    };
  }

  protected generateBeforeUpdateListener() {
    return (transform: Transform) => {
      const result = (this.target as any).push(transform);

      if (
        result &&
        result.then &&
        transform.options &&
        transform.options.blocking
      ) {
        return result.catch((e: Error) => {
          this.updateFailHandler(transform, e);
        });
      }
    };
  }

  protected generateQueryListener() {
    return (query: Query) => {
      this.onLine();
      this.cachePolicy.load(query);
    };
  }

  protected generateUpdateListener() {
    return () => {
      this.onLine();
    };
  }

  protected generateQueryFailListener() {
    return (query: Query, e: Error) => {
      this.queryFailHandler(query, e);
    };
  }

  protected generateUpdateFailListener() {
    return (transform: Transform, e: Error) => {
      this.updateFailHandler(transform, e);
    };
  }

  protected queryFailHandler(query: Query, e: Error) {
    if (e instanceof NetworkError) {
      this.offLine();
    }

    if (this.retryPolicy.canRetry && this.shouldRetryQuery(query, e)) {
      this.retry();
    } else {
      this.target.requestQueue.skip(e);
    }
  }

  protected updateFailHandler(transform: Transform, e: Error) {
    if (e instanceof NetworkError) {
      this.offLine();
    }

    if (this.retryPolicy.canRetry && this.shouldRetryUpdate(transform, e)) {
      this.retry();
    } else if (transform.options && transform.options.blocking) {
      this.skipAndThrowError(e);
    } else if (this.catch) {
      this.catch.apply(this, [transform, e]);
    } else {
      console.warn('No `catch` handler was defined.');
      this.skipAndThrowError(e);
    }
  }
}
