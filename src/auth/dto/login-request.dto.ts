import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginRequestDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsNotEmpty()
    @IsString()
    password: string;
}