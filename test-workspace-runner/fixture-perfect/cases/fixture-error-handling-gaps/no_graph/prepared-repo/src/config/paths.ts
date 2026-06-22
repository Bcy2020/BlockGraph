export const PATHS = {
  home: '/',
  login: '/login',
  discussions: '/discussions',
  discussion: (id: string) => `/discussions/${id}`,
  teams: '/teams',
  users: '/users',
  user: (id: string) => `/users/${id}`,
};
