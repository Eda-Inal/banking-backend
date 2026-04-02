import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { RedisService } from '../redis/redis.service';
import { StructuredLogger } from '../logger/structured-logger.service';

describe('TransactionsController', () => {
  let controller: TransactionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        TransactionsService,
        {
          provide: RedisService,
          useValue: {
            getClient: () => ({
              set: jest.fn(),
              del: jest.fn(),
              eval: jest.fn(),
            }),
          },
        },
        {
          provide: StructuredLogger,
          useValue: {
            warn: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
