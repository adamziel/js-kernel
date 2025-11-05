FROM emscripten/emsdk:latest

WORKDIR /src

# Copy source files
COPY wasmfs-fs.c .
COPY build.sh .

# Make build script executable
RUN chmod +x build.sh

# Set default command
CMD ["./build.sh"]
