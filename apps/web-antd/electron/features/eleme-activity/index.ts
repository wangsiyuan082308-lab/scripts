import ExcelJS from 'exceljs';

export class ElemeActivityGenerator {
  /**
   * 生成饿了么活动报名 Excel
   * @param inputString 分号分割的门店ID字符串
   * @returns Excel Buffer
   */
  static async run(inputString: string): Promise<Buffer> {
    // 1. 解析输入
    // 移除空白字符，按分号、逗号、空格、换行符等常见分隔符分割，去重，过滤空项
    const storeIds = [
      ...new Set(
        inputString
          .split(/[;；,，\s\n]+/) // 支持中英文分号、逗号、空白字符（空格、换行、制表符等）
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    ];

    if (storeIds.length === 0) {
      throw new Error('未找到有效的商品UPC数据');
    }

    // 2. 创建 Workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('活动报名表');

    // 3. 设置特殊的说明行（第一行）
    // 合并第一行所有单元格，并设置内容
    worksheet.mergeCells('A1:B1'); // 扩展到B1
    const noteCell = worksheet.getCell('A1');
    noteCell.value = '说明： \n 1、不要删除表头 \n 2、商品条形码：必填。';
    noteCell.alignment = {
      horizontal: 'left',
      vertical: 'top',
      wrapText: true,
    };
    noteCell.font = { bold: true, color: { argb: 'FFFF0000' } }; // 红色文字提醒

    // 设置行高以容纳多行文本
    worksheet.getRow(1).height = 60;

    // 4. 设置列宽
    worksheet.getColumn(1).width = 30; // 第一列宽度

    // 5. 设置表头行（第二行）
    const headerRow = worksheet.getRow(2);
    headerRow.values = ['商品条形码（必填）'];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // 6. 填充数据（从第三行开始）
    storeIds.forEach((id) => {
      worksheet.addRow([id]); // 商品条形码填入第一列
    });



    // 7. 生成 Buffer
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
