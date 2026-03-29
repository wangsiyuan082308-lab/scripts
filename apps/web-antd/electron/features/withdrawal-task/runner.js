// 使用桥接层调用现有提现脚本
import { executeWithdrawalSessionViaBridge } from './automation-bridge';
function toDate(input) {
    if (!input)
        return new Date();
    return input instanceof Date ? input : new Date(input);
}
function pad(value) {
    return String(value).padStart(2, '0');
}
export function formatScheduleTime(value) {
    if (!value)
        return undefined;
    const matched = value.match(/^(\d{1,2}):(\d{2})/);
    if (!matched)
        return undefined;
    const hour = Number(matched[1]);
    const minute = Number(matched[2]);
    if (Number.isNaN(hour) || Number.isNaN(minute))
        return undefined;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59)
        return undefined;
    return `${pad(hour)}:${pad(minute)}`;
}
export function formatScheduleFrequency(value) {
    return value === 'weekly' ? 'weekly' : 'daily';
}
export function formatScheduleWeekday(value) {
    if (typeof value !== 'number' || Number.isNaN(value))
        return 1;
    if (value < 0 || value > 6)
        return 1;
    return value;
}
export function computeNextRunAt(scheduleTime, from, scheduleFrequency, scheduleWeekday) {
    const normalized = formatScheduleTime(scheduleTime);
    if (!normalized)
        return undefined;
    const [hour, minute] = normalized.split(':').map(Number);
    const base = toDate(from);
    const next = new Date(base);
    const frequency = formatScheduleFrequency(scheduleFrequency);
    next.setSeconds(0, 0);
    if (frequency === 'weekly') {
        const weekday = formatScheduleWeekday(scheduleWeekday);
        const currentDay = next.getDay();
        let diff = weekday - currentDay;
        if (diff < 0)
            diff += 7;
        next.setDate(next.getDate() + diff);
        next.setHours(hour, minute, 0, 0);
        if (next.getTime() <= base.getTime()) {
            next.setDate(next.getDate() + 7);
        }
        return next.toISOString();
    }
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= base.getTime()) {
        next.setDate(next.getDate() + 1);
    }
    return next.toISOString();
}
export const WithdrawalTaskRunner = {
    async executeTask(task) {
        return executeWithdrawalSessionViaBridge(task);
    },
};
