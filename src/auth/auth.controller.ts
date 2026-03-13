import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterRequestDto } from './dto/register-request.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { LoginResponseDto } from './dto/login-response.dto';


@Controller('auth')
export class AuthController {

    constructor(private readonly authService: AuthService) { }

    @Post('register')
    async register(@Body() registerRequestDto: RegisterRequestDto): Promise<RegisterResponseDto> {
        return this.authService.register(registerRequestDto);
    }

    @Post('login')
    async login(@Body() loginRequestDto: LoginRequestDto): Promise<LoginResponseDto> {
        return this.authService.login(loginRequestDto);
    }
}
