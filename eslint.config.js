import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    /*
     * 站长控制台的共享零件模块：这里刻意把小组件、常量(DANGER_BTN/ACTION_LABEL)、
     * 格式化函数与取数 hook 放在一起 —— 后台九个面板都要用它们，拆成多个文件
     * 只会让每个面板 import 三四处。它不是"只导出组件的文件"，所以关掉这条规则。
     */
    files: ['src/components/admin/ui.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
