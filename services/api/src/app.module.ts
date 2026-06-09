import { DynamicModule, Module } from '@nestjs/common';
import * as config from './config.js';
import { Db } from './db/sqlite.js';
import { migrate } from './db/migrator.js';
import { Repository } from './db/repository.js';
import { CredentialService } from './secrets/credential.service.js';
import { SECRET_STORE, SecretStoreFactory, type SecretStore } from './secrets/secret-store.js';
import { ENGINE_CLIENT, HttpEngineClient, type EngineClient } from './engine/engine.client.js';
import { LogBus } from './bus/log-bus.js';
import { JobBus, JobsController, JobsService } from './modules/jobs.js';
import { ProvidersController } from './modules/providers.js';
import { PaperService, PortfolioController, TradingController } from './modules/trading.js';
import { MarketController } from './modules/market.js';
import { BacktestController } from './modules/backtest.js';
import { ModelsController } from './modules/models.js';
import { SchedulerService } from './modules/scheduler.js';
import {
  CoverageController,
  HealthController,
  LogsController,
  OnboardingController,
  SettingsController,
} from './modules/core.js';

export interface AppOptions {
  dbPath?: string;
  secretStore?: SecretStore;
  engineClient?: EngineClient;
}

@Module({})
export class AppModule {
  static forRoot(opts: AppOptions = {}): DynamicModule {
    const dbPath = opts.dbPath ?? config.sqlitePath();
    return {
      module: AppModule,
      controllers: [
        HealthController,
        OnboardingController,
        SettingsController,
        LogsController,
        CoverageController,
        ProvidersController,
        JobsController,
        TradingController,
        PortfolioController,
        MarketController,
        BacktestController,
        ModelsController,
      ],
      providers: [
        {
          provide: Db,
          useFactory: () => {
            const db = new Db(dbPath);
            migrate(db);
            return db;
          },
        },
        LogBus,
        {
          provide: Repository,
          useFactory: (db: Db, logBus: LogBus) => {
            const repo = new Repository(db, logBus);
            repo.seedProviders(config.PROVIDER_SEED);
            return repo;
          },
          inject: [Db, LogBus],
        },
        { provide: SECRET_STORE, useValue: opts.secretStore ?? SecretStoreFactory.create() },
        CredentialService,
        { provide: ENGINE_CLIENT, useValue: opts.engineClient ?? new HttpEngineClient() },
        JobBus,
        JobsService,
        PaperService,
        SchedulerService,
      ],
    };
  }
}
