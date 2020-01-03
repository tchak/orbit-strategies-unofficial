# orbit-strategies-unofficial

Experimental strategies for Orbit.js

## Usage

This package contains preconfigured strategies for Orbit.js.

- `PessimisticStrategy` if you are familiar with `ember-data`, you will get a very similar caching policy – you can add a `reload` or `backgroundReload` options to your queries. Plus by default a retry policy is applied.

- `OptimisticStrategy` should be used in combination with `BackupStrategy`. Just like `PessimisticStrategy` it includes caching and retry policies, but is designed to be offline first. By default it will drop any failed remote queries and respond with local data. For updates you need to override `catch` hook to handle failures.

## Installation

```
yarn add orbit-strategies-unofficial
```

## Contributing

### Installation

```
yarn install
```

### Building

Distributions can be built to the `/dist` directory by running:

```
yarn build
```

### Testing

#### CI Testing

Test in CI mode by running:

```
yarn test
```

#### Browser Testing

Test within a browser
(at [http://localhost:4200/tests/](http://localhost:4200/tests/)) by running:

```
yarn testem
```

## License

MIT License (see LICENSE for details).
