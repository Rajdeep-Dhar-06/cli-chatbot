import readLine from "node:readline/promises"
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ChatGroq } from "@langchain/groq";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { TavilySearch } from "@langchain/tavily"
import { DynamicTool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";

// Memory
const checkpointer = new MemorySaver();


// Initialise tools
const tavilyClient = new TavilySearch({
    maxresults: 3,
    apiKey: process.env.TAVILY_API_KEY, // optional
    topic: "general",
    searchDepth: "fast"
});

const tool = new DynamicTool({
    name: "tavily_search",
    description: "A search engine optimized for comprehensive, accurate, and trusted results. Useful for when you need to answer questions about current events. Input should be a search query.",
    func: async (input) => {
        const result = await tavilyClient.invoke({ query: input });
        return result;
    }
});
const tools = [tool];
const toolNode = new ToolNode(tools);


// Initialise LLM
const llm = new ChatGroq({
    model: "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY, // optional
    temperature: 0,
    maxTokens: undefined,
    maxRetries: 2
}).bindTools(tools);


// Condition
function shouldContinue(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "tools";
    }
    return "__end__";
}


async function callModel(state) {
    const systemMessage = {
        role: "system",
        content: "You are a helpful assistant. Keep all your responses extremely concise, strictly limiting yourself to one or two sentences. Output ONLY the direct answer without pleasantries."
    };

    // Inject system message dynamically here so it doesn't get duplicated in the graph memory
    const response = await llm.invoke([systemMessage, ...state.messages]);
    return { messages: [response] };
}


// Build graph
const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("agent", "__end__");


// Compile graph
const app = workflow.compile({ checkpointer }); // key-value


async function main() {
    const rl = readLine.createInterface({
        input: process.stdin, output: process.stdout
    });

    while (true) {
        const userInput = await rl.question("You : ");
        if (userInput === "exit") {
            break;
        }

        // Invoke
        const finalState = await app.invoke({
            messages: [
                { role: "user", content: userInput }
            ]
        },
            { configurable: { thread_id: "1" } });

        const lastMessage = finalState.messages[finalState.messages.length - 1];
        console.log("AI : ", lastMessage.content);
    }
    rl.close();
}

main();