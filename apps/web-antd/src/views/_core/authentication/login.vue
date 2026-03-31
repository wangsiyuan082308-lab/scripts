<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';

import { computed, markRaw, nextTick, ref, watch } from 'vue';

import { AuthenticationLogin, SliderCaptcha, z } from '@vben/common-ui';
import { $t } from '@vben/locales';

import MerchantSelector from './components/merchant-selector.vue';
import { useAuthStore } from '#/store';

defineOptions({ name: 'Login' });

const authStore = useAuthStore();
const authFormRef = ref<any>(null);

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.usernameTip'),
      },
      fieldName: 'username',
      label: $t('authentication.username'),
      rules: z.string().min(1, { message: $t('authentication.usernameTip') }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        placeholder: $t('authentication.password'),
      },
      fieldName: 'password',
      label: $t('authentication.password'),
      rules: z.string().min(1, { message: $t('authentication.passwordTip') }),
    },
    {
      component: markRaw(SliderCaptcha),
      fieldName: 'captcha',
      rules: z.boolean().refine((value) => value, {
        message: $t('authentication.verifyRequiredTip'),
      }),
    },
  ];
});

watch(
  () => authStore.loginStage,
  async (stage) => {
    if (stage !== 'credentials') {
      return;
    }

    await nextTick();
    const formApi = authFormRef.value?.getFormApi?.();
    if (!formApi) {
      return;
    }
    if (authStore.pendingLoginUsername) {
      formApi.setFieldValue('username', authStore.pendingLoginUsername);
    }
    formApi.setFieldValue('password', '');
    formApi.setFieldValue('captcha', false);
  },
);
</script>

<template>
  <MerchantSelector
    v-if="authStore.loginStage === 'merchantSelection'"
    :loading="authStore.loginLoading"
    :merchant-options="authStore.merchantOptions"
    :real-name="authStore.pendingLoginRealName"
    :selected-merchant-id="authStore.selectedMerchantId"
    :username="authStore.pendingLoginUsername"
    @back="authStore.backToCredentialStage"
    @confirm="authStore.confirmMerchantSelection"
    @update:selected-merchant-id="authStore.selectedMerchantId = $event"
  />
  <AuthenticationLogin
    v-else
    ref="authFormRef"
    :form-schema="formSchema"
    :loading="authStore.loginLoading"
    @submit="authStore.authLogin"
  />
</template>
