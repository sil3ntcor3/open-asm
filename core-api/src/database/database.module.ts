import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './database-config';
import { DatabaseService } from './database.service';

// Hard cap on how long any single runtime query may run, applied per connection
// in the app's pool. This turns a runaway query (e.g. an accidental
// cartesian-product aggregation) into a fast, logged error instead of a
// connection-pinning zombie that has to be killed by hand.
//
// Deliberately applied ONLY here, on the runtime TypeOrmModule connection — NOT
// to AppDataSource in database-config.ts, which the `migration` service uses.
// Schema migrations (e.g. creating an index on a multi-million-row table) can
// legitimately exceed this and must not be interrupted.
//
// Override with DB_STATEMENT_TIMEOUT_MS if a specific deploy needs more headroom.
const STATEMENT_TIMEOUT_MS = Number(
  process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000,
);

@Global()
@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      extra: {
        ...(dataSourceOptions.extra ?? {}),
        // node-postgres reads `statement_timeout` as milliseconds.
        statement_timeout: STATEMENT_TIMEOUT_MS,
      },
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
