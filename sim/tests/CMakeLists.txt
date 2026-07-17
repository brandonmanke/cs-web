add_executable(sim_tests sim_tests.cpp)
target_link_libraries(sim_tests PRIVATE cs_sim)
add_test(NAME sim_tests COMMAND sim_tests)
