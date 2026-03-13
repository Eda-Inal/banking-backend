import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class RegisterRequestDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsNotEmpty()
    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters long.' })
    @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, {
        message: 'Password must contain at least one uppercase letter and one number.',
    })
    password: string;

    @IsNotEmpty()
    @IsString()
    name: string;

    @IsNotEmpty()
    @IsString()
    @Matches(/^5\d{9}$/, { message: 'Phone must be 10 digits and start with 5.' })
    phone: string;
}