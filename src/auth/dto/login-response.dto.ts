export class LoginResponseDto {
    accessToken: string;
    expiresIn: number;
    tokenType: 'Bearer';
    user: {
        id: string;
        email: string;
        name: string;
    };
}
