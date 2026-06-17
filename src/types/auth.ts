export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
  roles: string[];
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface AuthLoginResponse {
  auth_url: string;
}
