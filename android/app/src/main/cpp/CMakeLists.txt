cmake_minimum_required(VERSION 3.18.1)
project(tkd-node)

include_directories(${CMAKE_SOURCE_DIR}/../../../libnode/include/node/)

add_library(tkd-node SHARED tkd-node.cpp)
set_target_properties(tkd-node PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON)

add_library(node-runtime SHARED IMPORTED)
set_target_properties(node-runtime PROPERTIES
    IMPORTED_LOCATION
    ${CMAKE_SOURCE_DIR}/../../../libnode/bin/${ANDROID_ABI}/libnode.so)

find_library(log-lib log)
target_link_libraries(tkd-node node-runtime ${log-lib})
