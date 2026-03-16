import { IsString, IsNotEmpty, Matches, MinLength } from 'class-validator';

export class UpdatePasswordRequestDto {
    @IsNotEmpty()
    @IsString()
    oldPassword: string;


    @IsNotEmpty()
    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters long.' })
    @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, {
        message: 'Password must contain at least one uppercase letter and one number.',
    })
    newPassword: string;
}