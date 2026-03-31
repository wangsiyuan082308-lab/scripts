<script setup lang="ts">
import type { AuthApi } from '#/api/core/auth';

import { computed } from 'vue';

import { Button, Empty, Tag } from 'ant-design-vue';

interface Props {
  loading?: boolean;
  merchantOptions?: AuthApi.MerchantOption[];
  realName?: string;
  selectedMerchantId?: string;
  username?: string;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  merchantOptions: () => [],
  realName: '',
  selectedMerchantId: '',
  username: '',
});

const emit = defineEmits<{
  back: [];
  confirm: [];
  'update:selectedMerchantId': [value: string];
}>();

const selectedLabel = computed(() => {
  const current = props.merchantOptions.find(
    (item) => item.merchantId === props.selectedMerchantId,
  );
  return current?.merchantName || '';
});

function handleSelect(merchantId: string) {
  emit('update:selectedMerchantId', merchantId);
}
</script>

<template>
  <div class="space-y-5">
    <div class="space-y-2">
      <div class="text-2xl font-semibold text-foreground">
        选择登录商户
      </div>
      <p class="text-sm text-muted-foreground">
        {{ realName || username || '当前账号' }} 可访问多个商户，请选择本次进入的目标商户。
      </p>
    </div>

    <div class="rounded-2xl border border-border/80 bg-muted/20 p-4">
      <div class="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        当前账号
      </div>
      <div class="mt-2 text-sm text-foreground">
        {{ realName || username }}
      </div>
      <div v-if="username" class="text-xs text-muted-foreground">
        {{ username }}
      </div>
    </div>

    <div v-if="merchantOptions.length > 0" class="space-y-3">
      <button
        v-for="option in merchantOptions"
        :key="option.merchantId"
        type="button"
        class="w-full rounded-2xl border px-4 py-4 text-left transition-all"
        :class="option.merchantId === selectedMerchantId
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border/80 bg-background hover:border-primary/40 hover:bg-muted/30'"
        @click="handleSelect(option.merchantId)"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-base font-medium text-foreground">
                {{ option.merchantName }}
              </span>
              <Tag v-if="option.isDefault" color="blue">
                默认商户
              </Tag>
            </div>
            <div class="text-xs text-muted-foreground">
              商户 ID：{{ option.merchantId }}
            </div>
          </div>
          <div class="shrink-0 text-xs text-muted-foreground">
            {{ option.role || 'operator' }}
          </div>
        </div>
      </button>
    </div>

    <div v-else class="rounded-2xl border border-dashed border-border/80 p-6">
      <Empty
        description="当前账号没有可用商户，请联系管理员。"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
      />
    </div>

    <div
      v-if="selectedLabel"
      class="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary"
    >
      当前将以“{{ selectedLabel }}”进入系统。
    </div>

    <div class="flex flex-col gap-3 sm:flex-row">
      <Button size="large" block @click="emit('back')">
        返回修改账号密码
      </Button>
      <Button
        type="primary"
        size="large"
        block
        :disabled="!selectedMerchantId"
        :loading="loading"
        @click="emit('confirm')"
      >
        确认进入
      </Button>
    </div>
  </div>
</template>
