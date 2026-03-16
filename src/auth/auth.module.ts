import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CONFIG_KEYS } from '../config/config';
import { JwtStrategy } from './jwt.strategy';
import { JwtGuard } from './jwt.guard';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expiresIn = Number(
          config.get(CONFIG_KEYS.JWT_ACCESS_EXPIRES_IN) ?? 900,
        );

        return {
          secret: config.get<string>(CONFIG_KEYS.JWT_SECRET),
          signOptions: { expiresIn },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtGuard, LoginRateLimitGuard],
  exports: [JwtGuard],
})
export class AuthModule {}
