import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface StorageUserContext {
  role: string;
  merchantId?: string;
  [key: string]: any;
}

/**
 * 泛型存储类，用于管理 JSON 文件存储
 * Generic Storage class for managing JSON file storage
 */
export class JSONStorage<T extends { id: string | number; merchantId?: string }> {
  private filePath: string;

  /**
   * 构造函数
   * @param filename - 存储文件名 (e.g., 'stores.json')
   */
  constructor(filename: string) {
    // 获取用户数据目录路径
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, filename);
  }

  /**
   * 获取所有数据
   * Get all data
   * @param user - 可选的用户上下文，用于过滤数据
   * @returns Promise<T[]> - 返回数据数组
   */
  async get(user?: StorageUserContext): Promise<T[]> {
    try {
      const dataStr = await fs.readFile(this.filePath, 'utf-8');
      let data: T[] = JSON.parse(dataStr);

      // 如果提供了用户上下文且不是超级管理员，则按 merchantId 过滤
      if (user && user.role !== 'super_admin') {
        if (user.merchantId) {
          data = data.filter((item) => item.merchantId === user.merchantId);
        } else {
          // 如果用户不是超级管理员且没有 merchantId，则看不到任何数据（或者是公共数据？）
          // 这里假设严格过滤
          return [];
        }
      }
      return data;
    } catch (error: any) {
      // 如果文件不存在，返回空数组
      // If file doesn't exist, return empty array
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * 保存数据到文件
   * Save data to file
   * @param data - 要保存的数据数组
   * @param user - 可选的用户上下文
   */
  async save(data: T[], user?: StorageUserContext): Promise<void> {
    if (user && user.role !== 'super_admin') {
       // 读取所有数据
       const allDataStr = await fs.readFile(this.filePath, 'utf-8').catch(() => '[]');
       const allData: T[] = JSON.parse(allDataStr);
       
       // 移除属于该商户的数据 (保留其他商户的数据)
       const otherData = allData.filter(d => d.merchantId !== user.merchantId);
       
       // 强制设置新数据的 merchantId
       if (user.merchantId) {
          data.forEach(d => d.merchantId = user.merchantId);
       }
       
       // 合并数据
       const newData = [...otherData, ...data];
       await fs.writeFile(this.filePath, JSON.stringify(newData, null, 2), 'utf-8');
    } else {
       await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
  }

  /**
   * 添加单个数据项
   * Add a single item
   * @param item - 要添加的数据项
   * @param user - 可选的用户上下文
   * @returns Promise<T[]> - 返回更新后的数据数组
   */
  async add(item: T, user?: StorageUserContext): Promise<T[]> {
    // 如果有用户上下文且不是超级管理员，强制设置 merchantId
    if (user && user.role !== 'super_admin' && user.merchantId) {
      item.merchantId = user.merchantId;
    }

    const dataStr = await fs.readFile(this.filePath, 'utf-8').catch(() => '[]');
    const data: T[] = JSON.parse(dataStr);

    // 检查是否存在相同 ID 的项，如果存在则更新，否则添加
    const index = data.findIndex((d) => d.id === item.id);
    if (index !== -1) {
      // 如果是更新，也要检查权限（虽然 add 通常用于新增，但这里包含更新逻辑）
      if (user && user.role !== 'super_admin') {
         const existingItem = data[index];
         if (existingItem.merchantId !== user.merchantId) {
             throw new Error('Permission denied: Cannot update item belonging to another merchant');
         }
      }
      data[index] = item;
    } else {
      data.push(item);
    }
    await this.save(data);
    
    // 返回过滤后的列表
    return this.get(user);
  }

  /**
   * 更新单个数据项
   * Update a single item
   * @param item - 要更新的数据项（必须包含 id）
   * @param user - 可选的用户上下文
   * @returns Promise<T[]> - 返回更新后的数据数组
   */
  async update(item: T, user?: StorageUserContext): Promise<T[]> {
    const dataStr = await fs.readFile(this.filePath, 'utf-8').catch(() => '[]');
    const data: T[] = JSON.parse(dataStr);
    
    const index = data.findIndex((d) => d.id === item.id);
    if (index !== -1) {
      const existingItem = data[index];

      // 权限检查
      if (user && user.role !== 'super_admin') {
        if (existingItem.merchantId !== user.merchantId) {
             throw new Error('Permission denied: Cannot update item belonging to another merchant');
        }
        // 强制 merchantId 保持不变或设为用户的 merchantId
        item.merchantId = user.merchantId;
      }

      // 合并更新
      data[index] = { ...existingItem, ...item };
      await this.save(data);
    }
    
    // 返回过滤后的列表
    return this.get(user);
  }

  /**
   * 删除单个数据项
   * Delete a single item
   * @param id - 要删除的数据项 ID
   * @param user - 可选的用户上下文
   * @returns Promise<T[]> - 返回更新后的数据数组
   */
  async delete(id: string | number, user?: StorageUserContext): Promise<T[]> {
    const dataStr = await fs.readFile(this.filePath, 'utf-8').catch(() => '[]');
    let data: T[] = JSON.parse(dataStr);

    if (user && user.role !== 'super_admin') {
        const itemToDelete = data.find(item => item.id === id);
        if (itemToDelete && itemToDelete.merchantId !== user.merchantId) {
             throw new Error('Permission denied: Cannot delete item belonging to another merchant');
        }
    }

    const newData = data.filter((item) => item.id !== id);
    await this.save(newData);
    
    // 返回过滤后的列表
    return this.get(user);
  }
}

// 导出单例实例
// Export singleton instances
export const storeStorage = new JSONStorage<any>('stores.json');
export const supplierStorage = new JSONStorage<any>('suppliers.json');
export const taskStorage = new JSONStorage<any>('tasks.json');
export const merchantStorage = new JSONStorage<any>('merchants.json');
export const withdrawalTaskStorage = new JSONStorage<any>('withdrawal-tasks.json');
