declare const processController: any;

const runnerModuleUrl = new URL('../shell/run.ts', import.meta.url).href;
const parserModuleUrl = new URL('../shell/sh.ts', import.meta.url).href;
const utilsModuleUrl = new URL('./lib/utils.ts', import.meta.url).href;

const createProgramSource = (): string => {
	const program = async function main(urls: {
		runUrl: string;
		parseUrl: string;
		utilsUrl: string;
	}): Promise<void> {
		const { errorToString, exitSafely, getArgv, writeStderr } =
			await import(/* @vite-ignore */ urls.utilsUrl);

		try {
			const argv = getArgv();

			if (argv.length !== 1) {
				writeStderr('sh: expected exactly one script path');
				exitSafely(1);
				return;
			}

			const scriptPath = argv[0];
			const fs = processController.fsSync;
			const decoder = new TextDecoder();

			let source: string;
			try {
				const data = fs.readFileSync(scriptPath, 'utf8');
				source =
					typeof data === 'string'
						? data
						: decoder.decode(data as Uint8Array);
			} catch (error) {
				writeStderr(`sh: ${scriptPath}: ${errorToString(error)}`);
				exitSafely(1);
				return;
			}

			let runShellScript: (
				pc: typeof processController,
				root: unknown
			) => Promise<number>;
			let parseShellCode: (code: string) => unknown;
			try {
				const [{ runShellScript: run }, { parseShellCode: parse }] =
					await Promise.all([
						import(/* @vite-ignore */ urls.runUrl),
						import(/* @vite-ignore */ urls.parseUrl),
					]);
				runShellScript = run!;
				parseShellCode = parse!;
			} catch (error) {
				writeStderr(
					`sh: failed to load shell runtime: ${errorToString(error)}`
				);
				exitSafely(1);
				return;
			}

			let ast: unknown;
			try {
				ast = parseShellCode(source);
			} catch (error) {
				writeStderr(`sh: ${scriptPath}: ${errorToString(error)}`);
				exitSafely(2);
				return;
			}

			try {
				const exitCode = await runShellScript(processController, ast);
				exitSafely(exitCode);
			} catch (error) {
				writeStderr(`sh: ${errorToString(error)}`);
				exitSafely(1);
			}
		} catch (error) {
			writeStderr(`sh: ${errorToString(error)}`);
			exitSafely(1);
		}
	};

	return `(${program.toString()})(${JSON.stringify({
		runUrl: runnerModuleUrl,
		parseUrl: parserModuleUrl,
		utilsUrl: utilsModuleUrl,
	})});`;
};

export const shProgramSource = createProgramSource();
