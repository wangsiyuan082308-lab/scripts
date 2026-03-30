import { JSONStorage } from '../../shared/storage';

export interface User {
  id: string;
  username: string;
  password?: string; // In a real app, this should be hashed.
  role: 'merchant_admin' | 'super_admin' | 'user';
  merchantId?: string;
  name?: string;
}

export class AuthFeature {
  private storage: JSONStorage<User>;

  constructor() {
    this.storage = new JSONStorage<User>('users.json');
  }

  /**
   * 初始化并播种默认用户
   * Initialize and seed default user
   */
  async init() {
    const users = await this.storage.get();
    const defaultUsers: User[] = [
      {
        id: '1',
        username: 'admin',
        password: 'password',
        role: 'super_admin',
        name: 'Super Admin',
      },
      {
        id: '2',
        username: 'vben',
        password: '123456',
        role: 'super_admin',
        name: 'Vben',
      },
    ];

    for (const defaultUser of defaultUsers) {
      const userIndex = users.findIndex((u) => u.username === defaultUser.username);
      if (userIndex === -1) {
        await this.storage.add(defaultUser);
        console.log(`${defaultUser.username} user created with default password.`);
      } else {
        const oldUser = users[userIndex];
        defaultUser.id = oldUser.id || defaultUser.id;
        await this.storage.update(defaultUser);
        console.log(`${defaultUser.username} user reset to default settings.`);
      }
    }
  }

  /**
   * 用户登录
   * User login
   * @param username
   * @param password
   */
  async login(username: string, password: string): Promise<null | User> {
    const users = await this.storage.get();
    const user = users.find(
      (u) => u.username === username && u.password === password,
    );
    if (user) {
      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      return userWithoutPassword as User;
    }
    return null;
  }
}

export const authFeature = new AuthFeature();
