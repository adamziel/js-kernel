import { EditorState } from '@codemirror/state';
import {
	EditorView,
	keymap,
	lineNumbers,
	highlightActiveLine,
	highlightActiveLineGutter,
	dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
	autocompletion,
	completionKeymap,
	closeBrackets,
	closeBracketsKeymap,
} from '@codemirror/autocomplete';
import {
	foldGutter,
	indentOnInput,
	bracketMatching,
	foldKeymap,
	syntaxHighlighting,
	defaultHighlightStyle,
	LanguageSupport,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';

export interface CodeEditorOptions {
	container: HTMLElement;
	onChange?: (content: string) => void;
	onSave?: (content: string) => void;
}

export class CodeEditor {
	private container: HTMLElement;
	private view: EditorView | null = null;
	private onChange?: (content: string) => void;
	private onSave?: (content: string) => void;
	private currentPath: string | null = null;

	constructor(options: CodeEditorOptions) {
		this.container = options.container;
		this.onChange = options.onChange;
		this.onSave = options.onSave;
		this.initialize();
	}

	private initialize() {
		const state = EditorState.create({
			doc: '',
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightActiveLine(),
				foldGutter(),
				dropCursor(),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				history(),
				highlightSelectionMatches(),
				autocompletion(),
				syntaxHighlighting(defaultHighlightStyle),
				EditorView.updateListener.of((update) => {
					if (update.docChanged && this.onChange) {
						this.onChange(update.state.doc.toString());
					}
				}),
				keymap.of([
					{
						key: 'Mod-s',
						preventDefault: true,
						run: () => {
							if (this.onSave) {
								this.onSave(this.view?.state.doc.toString() || '');
							}
							return true;
						},
					},
					...closeBracketsKeymap,
					...completionKeymap,
					...foldKeymap,
					...searchKeymap,
					...historyKeymap,
					...defaultKeymap,
					indentWithTab,
				]),
			],
		});

		this.view = new EditorView({
			state,
			parent: this.container,
		});
	}

	private getLanguageForPath(path: string): LanguageSupport | null {
		const extension = path.split('.').pop()?.toLowerCase();
		switch (extension) {
			case 'js':
			case 'jsx':
			case 'ts':
			case 'tsx':
				return javascript({ jsx: extension.includes('x'), typescript: extension.includes('ts') });
			case 'json':
				return json();
			case 'css':
				return css();
			case 'html':
			case 'htm':
				return html();
			case 'md':
			case 'markdown':
				return markdown();
			default:
				return null;
		}
	}

	public setContent(path: string, content: string) {
		if (!this.view) return;

		this.currentPath = path;
		const language = this.getLanguageForPath(path);

		const extensions = [
			lineNumbers(),
			highlightActiveLineGutter(),
			highlightActiveLine(),
			foldGutter(),
			dropCursor(),
			indentOnInput(),
			bracketMatching(),
			closeBrackets(),
			history(),
			highlightSelectionMatches(),
			autocompletion(),
			syntaxHighlighting(defaultHighlightStyle),
			EditorView.updateListener.of((update) => {
				if (update.docChanged && this.onChange) {
					this.onChange(update.state.doc.toString());
				}
			}),
			keymap.of([
				{
					key: 'Mod-s',
					preventDefault: true,
					run: () => {
						if (this.onSave) {
							this.onSave(this.view?.state.doc.toString() || '');
						}
						return true;
					},
				},
				...closeBracketsKeymap,
				...completionKeymap,
				...foldKeymap,
				...searchKeymap,
				...historyKeymap,
				...defaultKeymap,
				indentWithTab,
			]),
		];

		if (language) {
			extensions.push(language);
		}

		const newState = EditorState.create({
			doc: content,
			extensions,
		});

		this.view.setState(newState);
	}

	public getContent(): string {
		return this.view?.state.doc.toString() || '';
	}

	public focus() {
		this.view?.focus();
	}

	public destroy() {
		this.view?.destroy();
		this.view = null;
	}

	public setOnChange(callback: (content: string) => void) {
		this.onChange = callback;
	}

	public setOnSave(callback: (content: string) => void) {
		this.onSave = callback;
	}
}
