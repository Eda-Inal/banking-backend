import { IsEmail, IsString, IsOptional, Matches, IsNotEmpty } from 'class-validator';

export class UpdateUserMeRequestDto {
    @IsEmail()
    @IsOptional()
    @IsNotEmpty()
    email?: string;

    @IsString()
    @IsOptional()
    @IsNotEmpty()
    name?: string;

    @IsString()
    @IsOptional()
    @IsNotEmpty()
    @Matches(/^5\d{9}$/, { message: 'Phone must be 10 digits and start with 5.' })
    phone?: string;
}