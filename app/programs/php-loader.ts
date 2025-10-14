import { PHP } from '@php-wasm/universal'
import { loadWebRuntime } from '@php-wasm/web'

export async function loadPhp() {
	return new PHP(await loadWebRuntime('8.3'))
}
