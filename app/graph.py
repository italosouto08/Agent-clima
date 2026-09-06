from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_core.messages import HumanMessage
from app.tools import get_weather


load_dotenv()
tools = [get_weather]
model = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

def call_model(state):
    reponse = model.invoke(state["messages"])
    return {"messages": [reponse]}

graph = StateGraph(MessagesState)
graph.add_node("model", call_model)
graph.add_node("tools", ToolNode(tools))
graph.add_edge(START,"model")
graph.add_conditional_edges("model", tools_condition)
graph.add_edge("tools", "model")
compiled = graph.compile()


if __name__ == "__main__": 
    result = compiled.invoke({
        "messages": [HumanMessage(content="Qual o clima de Recife?")]
    })
    for message in result['messages']:
        print(type(message).__name__, message.content)