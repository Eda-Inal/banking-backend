import { IsNotEmpty, IsNumber, IsString, IsUUID, Min } from 'class-validator';

export class CreateTransferRequestDto {
    @IsNotEmpty()
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsNotEmpty()
    @IsString()
    referenceId: string;

    @IsNotEmpty()
    @IsUUID()
    toAccountId: string;

    @IsNotEmpty()
    @IsUUID()
    fromAccountId: string;
}