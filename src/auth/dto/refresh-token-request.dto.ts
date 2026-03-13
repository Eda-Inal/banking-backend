import { IsNotEmpty, IsString } from "class-validator";

export class RefreshTokenRequestDto {
    @IsNotEmpty()
    @IsString()
    refreshToken: string;
}