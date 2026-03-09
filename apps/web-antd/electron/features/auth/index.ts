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
    const adminIndex = users.findIndex((u) => u.username === 'admin');

    const newAdmin: User = {
      id: '1',
      username: 'admin',
      password: 'password', // Default password
      role: 'super_admin',
      name: 'Super Admin',
    };

    if (adminIndex === -1) {
      await this.storage.add(newAdmin);
      console.log('Admin user created with default password.');
    } else {
      // 强制覆盖 admin 用户，确保所有字段（包括 ID 和密码）都是预期的
      const oldAdmin = users[adminIndex];
      // 保留原有 ID 如果它存在，或者强制使用 '1'
      newAdmin.id = oldAdmin.id || '1';

      // 直接使用 update，确保 password 被重置
      await this.storage.update(newAdmin);
      console.log('Admin user reset to default settings.');
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
