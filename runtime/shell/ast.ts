export type ShellListOperator = ';' | '&' | '&&' | '||'

export type ProcessSubstDirection = 'Input' | 'Output'

export type RedirectKind =
	| 'Input'
	| 'Output'
	| 'Append'
	| 'HereDoc'
	| 'HereDocDash'
	| 'HereString'
	| 'InputDup'
	| 'OutputDup'

export interface Redirect {
	kind: RedirectKind
	file: string
}

export interface CasePattern {
	patterns: string[]
	body: Node
}

export type ParameterExpansionType =
	| { kind: 'Simple' }
	| { kind: 'Default'; value: string }
	| { kind: 'Assign'; value: string }
	| { kind: 'Error'; value: string }
	| { kind: 'Alternative'; value: string }
	| { kind: 'Length' }
	| { kind: 'RemoveSmallestPrefix'; value: string }
	| { kind: 'RemoveLargestPrefix'; value: string }
	| { kind: 'RemoveSmallestSuffix'; value: string }
	| { kind: 'RemoveLargestSuffix'; value: string }
	| { kind: 'Substring'; offset?: number | null; length?: number | null }
	| { kind: 'Indirect' }
	| { kind: 'ArrayAll' }
	| { kind: 'ArrayStar' }
	| { kind: 'ArrayLength' }
	| { kind: 'ArrayIndex'; index: string }

interface CommandData {
	name: string
	args: string[]
	redirects: Redirect[]
}

interface PipelineData {
	commands: Node[]
}

interface ListData {
	statements: Node[]
	operators: ShellListOperator[]
}

interface AssignmentData {
	name: string
	value: Node
}

interface CommandSubstitutionData {
	command: Node
}

interface ArithmeticExpansionData {
	expression: string
}

interface ArithmeticCommandData {
	expression: string
}

interface SubshellData {
	list: Node
}

interface CommentData {
	value: string
}

interface StringLiteralData {
	value: string
}

interface SingleQuotedStringData {
	value: string
}

interface ExtGlobPatternData {
	operator: '?' | '*' | '+' | '@' | '!'
	patterns: string[]
	suffix: string
}

interface IfStatementData {
	condition: Node
	consequence: Node
	alternative?: Node | null
}

interface ElifBranchData {
	condition: Node
	consequence: Node
}

interface ElseBranchData {
	consequence: Node
}

interface CaseStatementData {
	expression: Node
	patterns: CasePattern[]
}

interface ArrayData {
	elements: string[]
}

interface FunctionData {
	name: string
	body: Node
}

interface FunctionCallData {
	name: string
	args: string[]
	redirects: Redirect[]
}

interface ExportData {
	name: string
	value?: Node | null
}

interface ReturnData {
	value?: Node | null
}

interface ExtendedTestData {
	condition: Node
}

interface HistoryExpansionData {
	pattern: string
}

interface CompleteData {
	options: string[]
	command: string
}

interface ForLoopData {
	variable: string
	iterable: Node
	body: Node
}

interface WhileLoopData {
	condition: Node
	body: Node
}

interface UntilLoopData {
	condition: Node
	body: Node
}

interface NegationData {
	command: Node
}

interface SelectStatementData {
	variable: string
	items: Node
	body: Node
}

interface GroupData {
	list: Node
}

interface ParameterExpansionData {
	parameter: string
	expansion_type: ParameterExpansionType
}

interface ProcessSubstitutionData {
	command: Node
	direction: ProcessSubstDirection
}

interface NodeMap {
	Command: CommandData
	Pipeline: PipelineData
	List: ListData
	Assignment: AssignmentData
	CommandSubstitution: CommandSubstitutionData
	ArithmeticExpansion: ArithmeticExpansionData
	ArithmeticCommand: ArithmeticCommandData
	Subshell: SubshellData
	Comment: CommentData
	StringLiteral: StringLiteralData
	SingleQuotedString: SingleQuotedStringData
	ExtGlobPattern: ExtGlobPatternData
	IfStatement: IfStatementData
	ElifBranch: ElifBranchData
	ElseBranch: ElseBranchData
	CaseStatement: CaseStatementData
	Array: ArrayData
	Function: FunctionData
	FunctionCall: FunctionCallData
	Export: ExportData
	Return: ReturnData
	ExtendedTest: ExtendedTestData
	HistoryExpansion: HistoryExpansionData
	Complete: CompleteData
	ForLoop: ForLoopData
	WhileLoop: WhileLoopData
	UntilLoop: UntilLoopData
	Negation: NegationData
	SelectStatement: SelectStatementData
	Group: GroupData
	ParameterExpansion: ParameterExpansionData
	ProcessSubstitution: ProcessSubstitutionData
}

type NodeWrapper<K extends keyof NodeMap> = { [P in K]: NodeMap[K] }

export type Node = {
	[K in keyof NodeMap]: NodeWrapper<K>
}[keyof NodeMap]

export type NodeKind = keyof NodeMap

export type NodeOf<K extends NodeKind> = NodeWrapper<K>

export type CommandNode = NodeOf<'Command'>
export type Command = NodeMap['Command']
export type PipelineNode = NodeOf<'Pipeline'>
export type Pipeline = NodeMap['Pipeline']
export type ListNode = NodeOf<'List'>
export type List = NodeMap['List']
export type FunctionCallNode = NodeOf<'FunctionCall'>
export type FunctionCall = NodeMap['FunctionCall']
