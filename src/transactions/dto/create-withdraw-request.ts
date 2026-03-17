import { IsNotEmpty, IsNumber, IsPositive, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateWithdrawRequestDto {
    @IsNotEmpty()
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsNotEmpty()
    @IsString()
    referenceId: string;

    @IsNotEmpty()
    @IsUUID()
    fromAccountId: string;
}