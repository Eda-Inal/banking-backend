export class LoginResponseDto {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    tokenType: 'Bearer';
    user: {
        id: string;
        email: string;
        name: string;
    };
}
